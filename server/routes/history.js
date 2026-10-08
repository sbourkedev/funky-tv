const express = require('express');
const router = express.Router();
const { getDb } = require('../db/sqlite');
const { requireAuth } = require('../auth');

// Middleware to ensure authentication
router.use(requireAuth);

/**
 * GET /api/history
 * Returns the watch history for the authenticated user
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 20;

        const rows = db.prepare(`
            WITH ranked_history AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY CASE
                            WHEN item_type = 'episode' THEN
                                'series:' || COALESCE(
                                    source_id,
                                    ''
                                ) || ':' || COALESCE(
                                    parent_id,
                                    json_extract(data, '$.seriesId'),
                                    item_id
                                )
                            ELSE item_type || ':' || COALESCE(source_id, '') || ':' || item_id
                        END
                        ORDER BY updated_at DESC, id DESC
                    ) AS history_rank
                FROM watch_history
                WHERE user_id = ?
            )
            SELECT id, user_id, source_id, item_type, item_id, parent_id,
                progress, duration, updated_at, data
            FROM ranked_history
            WHERE history_rank = 1
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit);

        const history = rows.map(row => ({
            ...row,
            data: JSON.parse(row.data || '{}')
        }));

        res.json(history);
    } catch (err) {
        console.error('[History] Error fetching history:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

/**
 * GET /api/history/series/:sourceId/:seriesId
 * Returns saved progress for episodes in a series.
 */
router.get('/series/:sourceId/:seriesId', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT item_id, progress, duration,
                COALESCE(json_extract(data, '$.manualWatched'), 0) AS manually_watched
            FROM watch_history
            WHERE user_id = ?
                AND source_id = ?
                AND item_type = 'episode'
                AND (
                    parent_id = ?
                    OR CAST(json_extract(data, '$.seriesId') AS TEXT) = ?
                )
                AND progress > 0
        `).all(
            req.user.id,
            req.params.sourceId,
            req.params.seriesId,
            req.params.seriesId
        );

        res.json(rows.map(row => ({
            ...row,
            watched: Boolean(row.manually_watched) || (row.duration > 0 && row.progress >= row.duration * 0.9)
        })));
    } catch (err) {
        console.error('[History] Error fetching watched episodes:', err);
        res.status(500).json({ error: 'Failed to fetch watched episodes' });
    }
});

/**
 * GET /api/history/movies/:sourceId
 * Returns saved progress for movies from a source.
 */
router.get('/movies/:sourceId', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT item_id, progress, duration
            FROM watch_history
            WHERE user_id = ?
                AND source_id = ?
                AND item_type = 'movie'
                AND progress > 0
        `).all(req.user.id, req.params.sourceId);

        res.json(rows.map(row => ({
            ...row,
            watched: row.duration > 0 && row.progress >= row.duration * 0.9
        })));
    } catch (err) {
        console.error('[History] Error fetching movie progress:', err);
        res.status(500).json({ error: 'Failed to fetch movie progress' });
    }
});

/**
 * POST /api/history
 * Saves/updates watch progress for an item
 */
router.post('/', (req, res) => {
    try {
        const db = getDb();
        const userId = req.user.id;
        const { id, type, parentId, progress, duration, data, sourceId } = req.body;

        if (!id || !type) {
            return res.status(400).json({ error: 'Missing required fields (id, type)' });
        }

        const compositeId = `${userId}:${id}`;
        const timestamp = Date.now();

        const stmt = db.prepare(`
            INSERT INTO watch_history (id, user_id, source_id, item_type, item_id, parent_id, progress, duration, updated_at, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id,
                parent_id = excluded.parent_id,
                progress = excluded.progress,
                duration = excluded.duration,
                updated_at = excluded.updated_at,
                data = CASE
                    WHEN json_valid(watch_history.data)
                        AND COALESCE(json_extract(watch_history.data, '$.manualWatched'), 0) = 1
                    THEN json_set(excluded.data, '$.manualWatched', 1)
                    ELSE excluded.data
                END
        `);

        stmt.run(
            compositeId,
            userId,
            sourceId || null,
            type,
            id.toString(),
            parentId ? parentId.toString() : null,
            progress || 0,
            duration || 0,
            timestamp,
            JSON.stringify(data || {})
        );

        res.json({ success: true, timestamp });
    } catch (err) {
        console.error('[History] Error saving progress:', err);
        res.status(500).json({ error: 'Failed to save progress' });
    }
});

/**
 * DELETE /api/history/series/:sourceId/:seriesId
 * Removes all episode history entries for a series.
 */
router.delete('/series/:sourceId/:seriesId', (req, res) => {
    try {
        const db = getDb();
        const result = db.prepare(`
            DELETE FROM watch_history
            WHERE user_id = ?
                AND source_id = ?
                AND item_type = 'episode'
                AND (
                    parent_id = ?
                    OR CAST(json_extract(data, '$.seriesId') AS TEXT) = ?
                )
        `).run(
            req.user.id,
            req.params.sourceId,
            req.params.seriesId,
            req.params.seriesId
        );

        res.json({ success: true, removed: result.changes });
    } catch (err) {
        console.error('[History] Error deleting series history:', err);
        res.status(500).json({ error: 'Failed to delete series history' });
    }
});

/**
 * DELETE /api/history/:itemId
 * Removes an item from the user's watch history
 */
router.delete('/:itemId', (req, res) => {
    try {
        const db = getDb();
        const userId = req.user.id;
        const itemId = req.params.itemId;

        const compositeId = `${userId}:${itemId}`;

        const stmt = db.prepare('DELETE FROM watch_history WHERE id = ? AND user_id = ?');
        const result = stmt.run(compositeId, userId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Item not found in history' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[History] Error deleting history item:', err);
        res.status(500).json({ error: 'Failed to delete history item' });
    }
});

module.exports = router;
