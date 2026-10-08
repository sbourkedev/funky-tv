/**
 * Series Page Controller
 * Handles TV series browsing and playback
 */

class SeriesPage {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('series-grid');
        this.sourceSelect = document.getElementById('series-source-select');
        this.categorySelect = document.getElementById('series-category-select');
        this.searchInput = document.getElementById('series-search');
        this.detailsPanel = document.getElementById('series-details');
        this.seasonsContainer = document.getElementById('series-seasons');
        this.seriesPlayButton = document.querySelector('.series-play-btn');

        this.seriesList = [];
        this.categories = [];
        this.sources = [];
        this.currentBatch = 0;
        this.batchSize = 24;
        this.filteredSeries = [];
        this.isLoading = false;
        this.observer = null;
        this.hiddenCategoryIds = new Set();
        this.currentSeries = null;
        this.overviewStorageKey = 'funky-player-series-overview';
        this.preserveDetailsOnNextShow = false;
        this.pendingSeriesOverview = null;
        this.episodeWatchStatus = new Map();
        this.favoriteIds = new Set(); // Track favorite series IDs

        this.init();
    }

    init() {
        // Source change handler
        this.sourceSelect?.addEventListener('change', async () => {
            await this.loadCategories();
            await this.loadSeries();
        });

        // Category change handler
        this.categorySelect?.addEventListener('change', () => {
            this.loadSeries();
        });

        // Search with debounce
        let searchTimeout;
        this.searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.filterAndRender(), 300);
        });

        // Back button
        document.querySelector('.series-back-btn')?.addEventListener('click', () => {
            this.hideDetails();
        });

        document.querySelector('.series-reset-progress-btn')?.addEventListener('click', () => {
            this.resetSeriesProgress();
        });

        this.seriesPlayButton?.addEventListener('click', () => {
            this.playSeriesFromOverview();
        });

        // Set up IntersectionObserver for lazy loading
        this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.isLoading) {
                this.renderNextBatch();
            }
        }, { rootMargin: '200px' });

    }

    async show({ resetFilters = false } = {}) {
        if (resetFilters) {
            await this.resetFiltersAndRefresh();
            return;
        }
        // Keep the selected series overview visible when returning from playback.
        const preserveDetails = this.preserveDetailsOnNextShow;
        this.preserveDetailsOnNextShow = false;
        if (!preserveDetails) {
            let savedOverview = null;
            try {
                const saved = sessionStorage.getItem(this.overviewStorageKey);
                if (saved) savedOverview = JSON.parse(saved);
            } catch (err) {
                console.warn('[Series] Could not restore saved series overview:', err);
                sessionStorage.removeItem(this.overviewStorageKey);
            }

            if (savedOverview) {
                const isCurrentSeries = this.currentSeries
                    && String(this.currentSeries.sourceId) === String(savedOverview.sourceId)
                    && String(this.currentSeries.series_id) === String(savedOverview.series_id);
                if (!isCurrentSeries) this.pendingSeriesOverview = savedOverview;
            } else {
                this.hideDetails();
            }
        }

        // Load sources if not loaded
        // Load sources if not loaded
        if (this.sources.length === 0) {
            await this.loadSources();
        }

        // Load favorites
        await this.loadFavorites();

        // Load series if empty
        if (this.seriesList.length === 0) {
            await this.loadCategories();
            await this.loadSeries();
        } else {
            this.filterAndRender();
        }

        // A page reload loses the in-memory series selection, so rebuild its overview
        // from the metadata saved with the player's playback snapshot.
        if (this.pendingSeriesOverview) {
            const series = this.pendingSeriesOverview;
            this.pendingSeriesOverview = null;
            await this.showSeriesDetails(series, { skipAutoResume: true });
        }
    }

    async refreshCurrentSeriesProgress(content) {
        const series = this.currentSeries;
        if (!series
            || String(series.sourceId) !== String(content.sourceId)
            || String(series.series_id) !== String(content.seriesId)) {
            return;
        }

        try {
            const rows = await API.history.getSeriesEpisodeProgress(content.sourceId, content.seriesId);
            if (this.currentSeries !== series) return;

            this.episodeWatchStatus = new Map(rows.map(row => [String(row.item_id), row]));
            this.updateSeriesPlaybackButton();
            this.seasonsContainer.querySelectorAll('.episode-item').forEach(episodeEl => {
                this.renderEpisodeWatchStatus(episodeEl);
            });
            this.seasonsContainer.querySelectorAll('.season-group').forEach(seasonGroup => {
                const wasCollapsed = seasonGroup.classList.contains('collapsed');
                const episodeEls = [...seasonGroup.querySelectorAll('.episode-item')];
                this.updateSeasonWatchButton(seasonGroup);
                const allWatched = episodeEls.length > 0 && episodeEls.every(episodeEl =>
                    this.episodeWatchStatus.get(String(episodeEl.dataset.episodeId))?.watched
                );
                if (!allWatched) seasonGroup.classList.toggle('collapsed', wasCollapsed);
            });
        } catch (err) {
            console.warn('[Series] Could not refresh episode progress after playback:', err.message);
        }
    }
    prepareReturnFromPlayer(content) {
        if (!content || content.type !== 'series' || !content.seriesId || !content.sourceId) return;

        this.preserveDetailsOnNextShow = true;
        const isCurrentSeries = this.currentSeries
            && String(this.currentSeries.sourceId) === String(content.sourceId)
            && String(this.currentSeries.series_id) === String(content.seriesId);

        if (!isCurrentSeries) {
            this.pendingSeriesOverview = {
                sourceId: content.sourceId,
                series_id: content.seriesId,
                name: content.title || 'Series',
                cover: content.poster || '',
                plot: content.description || '',
                year: content.year || '',
                rating: content.rating || ''
            };
        }
    }

    async resetFiltersAndRefresh() {
        this.hideDetails();
        // Replace the previous results before any network-backed setup calls so
        // they do not flash while the refreshed list is being prepared.
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        this.pendingSeriesOverview = null;
        this.preserveDetailsOnNextShow = false;
        if (this.searchInput) this.searchInput.value = '';
        if (this.sourceSelect) this.sourceSelect.value = '';
        if (this.categorySelect) this.categorySelect.value = '';
        if (this.sources.length === 0) await this.loadSources();
        await this.loadFavorites();
        await this.loadCategories();
        await this.loadSeries();
    }

    hide() {
        // Page is hidden
    }

    async loadFavorites() {
        try {
            const favs = await API.favorites.getAll(null, 'series');
            this.favoriteIds = new Set(favs.map(f => `${f.source_id}:${f.item_id}`));
        } catch (err) {
            console.error('Error loading favorites:', err);
        }
    }

    async loadSources() {
        try {
            const allSources = await API.sources.getAll();
            this.sources = allSources.filter(s => s.type === 'xtream' && s.enabled);

            this.sourceSelect.innerHTML = '<option value="">All Sources</option>';
            this.sources.forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = s.name;
                this.sourceSelect.appendChild(option);
            });
        } catch (err) {
            console.error('Error loading sources:', err);
        }
    }

    async loadCategories() {
        try {
            this.categories = [];
            this.hiddenCategoryIds = new Set();
            this.categorySelect.innerHTML = '<option value="">All Categories</option>';

            const sourceId = this.sourceSelect.value;
            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            // Fetch hidden items for each source
            for (const source of sourcesToLoad) {
                try {
                    const hiddenItems = await API.channels.getHidden(source.id);
                    hiddenItems.forEach(h => {
                        if (h.item_type === 'series_category') {
                            this.hiddenCategoryIds.add(`${source.id}:${h.item_id}`);
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load hidden items from source ${source.id}`);
                }
            }

            for (const source of sourcesToLoad) {
                try {
                    const cats = await API.proxy.xtream.seriesCategories(source.id);
                    if (cats && Array.isArray(cats)) {
                        cats.forEach(c => {
                            // Skip hidden categories
                            if (!this.hiddenCategoryIds.has(`${source.id}:${c.category_id}`)) {
                                this.categories.push({ ...c, sourceId: source.id });
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load series categories from source ${source.id}:`, err.message);
                }
            }

            // Populate dropdown
            this.categories.forEach(c => {
                const option = document.createElement('option');
                option.value = `${c.sourceId}:${c.category_id}`;
                option.textContent = c.category_name;
                this.categorySelect.appendChild(option);
            });
        } catch (err) {
            console.error('Error loading categories:', err);
        }
    }

    async loadSeries() {
        this.isLoading = true;
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            this.seriesList = [];

            const sourceId = this.sourceSelect.value;
            const categoryValue = this.categorySelect.value;

            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            for (const source of sourcesToLoad) {
                try {
                    // Parse category if selected
                    let catId = null;
                    if (categoryValue) {
                        const [catSourceId, categoryId] = categoryValue.split(':');
                        if (parseInt(catSourceId) === source.id) {
                            catId = categoryId;
                        } else if (sourceId) {
                            continue;
                        }
                    }

                    const series = await API.proxy.xtream.series(source.id, catId);
                    console.log(`[Series] Source ${source.id}, Category ${catId || 'ALL'}: Got ${series?.length || 0} series`);
                    if (series && Array.isArray(series)) {
                        series.forEach(s => {
                            // Skip series from hidden categories
                            if (this.hiddenCategoryIds.has(`${source.id}:${s.category_id}`)) {
                                return;
                            }
                            this.seriesList.push({
                                ...s,
                                sourceId: source.id,
                                id: `${source.id}:${s.series_id}`
                            });
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load series from source ${source.id}:`, err.message);
                }
            }

            console.log(`[Series] Total loaded: ${this.seriesList.length} series`);
            this.filterAndRender();
        } catch (err) {
            console.error('Error loading series:', err);
            this.container.innerHTML = '<div class="empty-state"><p>Error loading series</p></div>';
        } finally {
            this.isLoading = false;
        }
    }

    filterAndRender() {
        const searchTerm = this.searchInput?.value?.toLowerCase() || '';

        this.filteredSeries = this.seriesList.filter(s => {
            if (searchTerm && !s.name?.toLowerCase().includes(searchTerm)) {
                return false;
            }
            return true;
        });

        console.log(`[Series] Displaying ${this.filteredSeries.length} of ${this.seriesList.length} series`);

        this.currentBatch = 0;
        this.container.innerHTML = '';

        if (this.filteredSeries.length === 0) {
            this.container.innerHTML = '<div class="empty-state"><p>No series found</p></div>';
            return;
        }

        const favoritesShelf = this.createFavoritesShelf();
        if (favoritesShelf) this.container.appendChild(favoritesShelf);

        // Create loader element
        const loader = document.createElement('div');
        loader.className = 'series-loader';
        loader.innerHTML = '<div class="loading-spinner"></div>';
        this.container.appendChild(loader);

        // Render initial batches
        for (let i = 0; i < 5; i++) {
            this.renderNextBatch();
        }

        // Start observing loader
        this.observer.observe(loader);
    }

    renderNextBatch() {
        const start = this.currentBatch * this.batchSize;
        const end = start + this.batchSize;
        const batch = this.filteredSeries.slice(start, end);

        if (batch.length === 0) {
            const loader = this.container.querySelector('.series-loader');
            if (loader) loader.style.display = 'none';
            return;
        }

        const fragment = document.createDocumentFragment();

        batch.forEach(series => {
            fragment.appendChild(this.createSeriesCard(series));
        });

        // Insert before loader
        const loader = this.container.querySelector('.series-loader');
        if (loader) {
            this.container.insertBefore(fragment, loader);
        } else {
            this.container.appendChild(fragment);
        }

        this.currentBatch++;

        // Hide loader if done
        if (end >= this.filteredSeries.length && loader) {
            loader.style.display = 'none';
        }
    }

    createSeriesCard(series) {
        const card = document.createElement('div');
        card.className = 'series-card';
        card.dataset.seriesId = series.series_id;
        card.dataset.sourceId = series.sourceId;

        const poster = series.cover || '/img/placeholder.png';
        const year = series.year || series.releaseDate?.substring(0, 4) || '';
        const rating = series.rating ? `${Icons.star} ${series.rating}` : '';
        const isFav = this.favoriteIds.has(`${series.sourceId}:${series.series_id}`);
        card.innerHTML = `
            <div class="series-poster">
                <img src="${poster}" alt="${series.name}"
                     onerror="this.onerror=null;this.src='/img/placeholder.png'" loading="lazy">
                <div class="series-play-overlay">
                    <span class="play-icon">${Icons.play}</span>
                </div>
                <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                    <span class="fav-icon">${isFav ? Icons.favorite : Icons.favoriteOutline}</span>
                </button>
            </div>
            <div class="series-card-info">
                <div class="series-title">${series.name}</div>
                <div class="series-meta">
                    ${year ? `<span>${year}</span>` : ''}
                    ${rating ? `<span>${rating}</span>` : ''}
                </div>
                <button class="series-overview-button" type="button">Overview</button>
            </div>
        `;
        card.addEventListener('click', (event) => {
            if (event.target.closest('.favorite-btn')) {
                this.toggleFavorite(series, event.target.closest('.favorite-btn'));
                event.stopPropagation();
            } else if (event.target.closest('.series-overview-button')) {
                event.stopPropagation();
                this.showSeriesDetails(series, { skipAutoResume: true });
            } else {
                this.showSeriesDetails(series);
            }
        });
        return card;
    }

    createFavoritesShelf() {
        const favorites = this.filteredSeries.filter(series =>
            this.favoriteIds.has(`${series.sourceId}:${series.series_id}`)
        );
        if (favorites.length === 0) return null;

        const shelf = document.createElement('section');
        shelf.className = 'favorites-shelf';
        shelf.innerHTML = '<h3 class="favorites-shelf-title">Favourite Series</h3>';
        const cards = document.createElement('div');
        cards.className = 'favorites-shelf-cards';
        favorites.forEach(series => cards.appendChild(this.createSeriesCard(series)));
        shelf.appendChild(cards);
        return shelf;
    }

    async showSeriesDetails(series, { skipAutoResume = false } = {}) {
        this.currentSeries = series;
        try {
            sessionStorage.setItem(this.overviewStorageKey, JSON.stringify({
                sourceId: series.sourceId,
                series_id: series.series_id,
                name: series.name || 'Series',
                cover: series.cover || '',
                plot: series.plot || '',
                year: series.year || '',
                rating: series.rating || ''
            }));
        } catch (err) {
            console.warn('[Series] Could not save selected series overview:', err);
        }

        // Show details panel
        this.container.classList.add('hidden');
        this.detailsPanel.classList.remove('hidden');
        if (this.seriesPlayButton) this.seriesPlayButton.disabled = true;

        // Set header info
        document.getElementById('series-poster').src = series.cover || '/img/placeholder.png';
        document.getElementById('series-title').textContent = series.name;
        document.getElementById('series-plot').textContent = series.plot || '';

        // Show loading
        this.seasonsContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            // Fetch series info (seasons/episodes)
            const info = await API.proxy.xtream.seriesInfo(series.sourceId, series.series_id);

            if (!info || !info.episodes) {
                this.seasonsContainer.innerHTML = '<p class="hint">No episodes found</p>';
                return;
            }

            // Store series info for WatchPage
            this.currentSeriesInfo = info;
            this.renderSeriesOverviewMetadata(series, info);

            this.episodeWatchStatus = new Map();
            try {
                const progressRows = await API.history.getSeriesEpisodeProgress(series.sourceId, series.series_id);
                this.episodeWatchStatus = new Map(progressRows.map(row => [String(row.item_id), row]));
            } catch (err) {
                console.warn('[Series] Could not load watched episode status:', err.message);
            }

            this.updateSeriesPlaybackButton();

            const resumeEpisode = skipAutoResume ? null : this.findBottommostInProgressEpisode(info);
            if (resumeEpisode && await this.playEpisodeData(series, resumeEpisode.episode, resumeEpisode.seasonNum)) {
                return;
            }

            // Render seasons and episodes
            let html = '';
            const seasons = Object.keys(info.episodes).sort((a, b) => parseInt(a) - parseInt(b));

            seasons.forEach(seasonNum => {
                const episodes = info.episodes[seasonNum];
                const seasonWatched = episodes.length > 0 && episodes.every(ep =>
                    this.episodeWatchStatus.get(String(ep.id))?.watched
                );
                html += `
                <div class="season-group ${seasonWatched ? 'collapsed' : ''}" data-season="${seasonNum}">
                    <div class="season-header">
                        <span class="season-expander">${Icons.chevronDown}</span>
                        <span class="season-name">Season ${seasonNum} (${episodes.length} episodes)</span>
                        ${seasonWatched ? '<span class="season-watched-badge">&#10003; Watched</span>' : ''}
                        <button class="season-watch-toggle" type="button">${seasonWatched ? 'Mark season unwatched' : 'Mark season watched'}</button>
                    </div>
                    <div class="episode-list">
                        ${episodes.map(ep => {
                    const status = this.episodeWatchStatus.get(String(ep.id));
                    const watched = Boolean(status?.watched);
                    const inProgress = !watched && status?.progress > 0;
                    return `
                            <div class="episode-item ${watched ? 'watched' : ''} ${inProgress ? 'in-progress' : ''}" data-episode-id="${ep.id}" data-source-id="${series.sourceId}" data-container="${ep.container_extension || 'mp4'}">
                                <span class="episode-number">E${ep.episode_num}</span>
                                <span class="episode-title">${ep.title || `Episode ${ep.episode_num}`}</span>
                                <span class="episode-duration">${ep.duration || ''}</span>
                                ${watched ? '<span class="episode-watched-badge" title="Watched">&#10003; Watched</span>' : ''}
                                ${inProgress ? `<span class="episode-resume-badge">Continue &middot; ${this.formatResumeTime(status.progress)}</span>` : ''}
                                <button class="episode-set-progress" type="button" aria-label="Set progress to this episode" title="Set progress to this episode">Set progress here</button>
                                <button class="episode-watch-toggle" type="button" aria-label="Mark episode ${watched ? 'unwatched' : 'watched'}" title="Mark ${watched ? 'unwatched' : 'watched'}">Mark ${watched ? 'unwatched' : 'watched'}</button>
                            </div>
                        `;
                }).join('')}
                    </div>
                </div>`;
            });

            this.seasonsContainer.innerHTML = html;

            // Add click handlers
            this.seasonsContainer.querySelectorAll('.season-header').forEach(header => {
                header.addEventListener('click', () => {
                    header.closest('.season-group').classList.toggle('collapsed');
                });
            });

            this.seasonsContainer.querySelectorAll('.episode-watch-toggle').forEach(button => {
                if (button.classList.contains('season-watch-toggle')) return;
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const episodeEl = button.closest('.episode-item');
                    const watched = !this.episodeWatchStatus.get(String(episodeEl.dataset.episodeId))?.watched;
                    this.setEpisodeWatched(episodeEl, watched, button);
                });
            });

            this.seasonsContainer.querySelectorAll('.season-watch-toggle').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const seasonGroup = button.closest('.season-group');
                    const episodeEls = [...seasonGroup.querySelectorAll('.episode-item')];
                    const allWatched = episodeEls.length > 0 && episodeEls.every(ep =>
                        this.episodeWatchStatus.get(String(ep.dataset.episodeId))?.watched
                    );
                    this.setSeasonWatched(seasonGroup, episodeEls, !allWatched, button);
                });
            });

            this.seasonsContainer.querySelectorAll('.episode-set-progress').forEach(button => {
                button.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    await this.setProgressToEpisode(button.closest('.episode-item'), button);
                });
            });

            this.seasonsContainer.querySelectorAll('.episode-item').forEach(ep => {
                ep.addEventListener('click', (event) => {
                    if (event.target.closest('.episode-watch-toggle, .episode-set-progress')) return;
                    this.playEpisode(ep);
                });
            });

        } catch (err) {
            console.error('Error loading series info:', err);
            this.seasonsContainer.innerHTML = '<p class="hint" style="color: var(--color-error);">Error loading episodes</p>';
        }
    }

    hideDetails() {
        this.detailsPanel.classList.add('hidden');
        this.container.classList.remove('hidden');
        this.currentSeries = null;
        sessionStorage.removeItem(this.overviewStorageKey);
    }

    async playEpisode(episodeEl) {
        const episodeId = episodeEl.dataset.episodeId;
        const seasonGroup = episodeEl.closest('.season-group');
        const seasonNum = seasonGroup?.dataset.season || '1';
        const episode = Object.values(this.currentSeriesInfo?.episodes || {})
            .flat()
            .find(item => String(item.id) === String(episodeId));
        if (episode) return this.playEpisodeData(this.currentSeries, episode, seasonNum);

        console.warn(`[Series] Episode ${episodeId} was not found in loaded series info`);
    }

    findBottommostInProgressEpisode(info) {
        const seasons = Object.keys(info?.episodes || {}).sort((a, b) => Number(a) - Number(b));
        let latest = null;

        seasons.forEach(seasonNum => {
            const episodes = [...(info.episodes[seasonNum] || [])]
                .sort((a, b) => Number(a.episode_num) - Number(b.episode_num));
            episodes.forEach(episode => {
                const status = this.episodeWatchStatus.get(String(episode.id));
                if (status?.progress > 0 && !status.watched) latest = { episode, seasonNum };
            });
        });

        return latest;
    }

    updateSeriesPlaybackButton() {
        if (!this.seriesPlayButton) return;
        const hasEpisodes = Object.values(this.currentSeriesInfo?.episodes || {}).some(
            episodes => Array.isArray(episodes) && episodes.length > 0
        );
        const hasProgress = Boolean(this.findBottommostInProgressEpisode(this.currentSeriesInfo));
        this.seriesPlayButton.textContent = hasProgress ? 'Continue Watching' : 'Play Series';
        this.seriesPlayButton.disabled = !hasEpisodes;
    }

    async playSeriesFromOverview() {
        if (!this.currentSeries || !this.currentSeriesInfo || !this.seriesPlayButton || this.seriesPlayButton.disabled) return;

        let target = this.findBottommostInProgressEpisode(this.currentSeriesInfo);
        if (!target) {
            const seasonNum = Object.keys(this.currentSeriesInfo.episodes || {})
                .sort((a, b) => Number(a) - Number(b))
                .find(season => this.currentSeriesInfo.episodes[season]?.length);
            const episode = seasonNum
                ? [...this.currentSeriesInfo.episodes[seasonNum]]
                    .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))[0]
                : null;
            if (episode) target = { episode, seasonNum };
        }

        if (target) await this.playEpisodeData(this.currentSeries, target.episode, target.seasonNum);
    }

    async playEpisodeData(series, episode, seasonNum) {
        const episodeId = episode.id;
        const sourceId = series.sourceId;
        const container = episode.container_extension || 'mp4';
        const episodeNum = episode.episode_num || '1';
        const episodeTitle = episode.title || `Episode ${episodeNum}`;
        const episodeStatus = this.episodeWatchStatus.get(String(episodeId));

        try {
            const result = await API.proxy.xtream.getStreamUrl(sourceId, episodeId, 'series', container);
            if (!result?.url || !this.app.pages.watch) return false;

            await this.app.pages.watch.play({
                type: 'series',
                id: episodeId,
                title: series.name || 'Series',
                subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                poster: series.cover,
                description: series.plot || '',
                year: series.year,
                rating: series.rating,
                sourceId,
                seriesId: series.series_id,
                seriesInfo: this.currentSeriesInfo,
                currentSeason: seasonNum,
                currentEpisode: episodeNum,
                containerExtension: container,
                resumeTime: episodeStatus && !episodeStatus.watched
                    ? Math.max(0, Number(episodeStatus.progress) - 5)
                    : 0
            }, result.url);
            return true;
        } catch (err) {
            console.error('Error playing episode:', err);
            return false;
        }
    }

    async setEpisodeWatched(episodeEl, watched, button, keepDisabled = false) {
        const episodeId = String(episodeEl.dataset.episodeId);
        const previousStatus = this.episodeWatchStatus.get(episodeId);
        button.disabled = true;

        try {
            if (watched) {
                const duration = this.getEpisodeDurationSeconds(episodeEl, previousStatus);
                const seasonNum = episodeEl.closest('.season-group')?.dataset.season || '1';
                const episodeNum = episodeEl.querySelector('.episode-number')?.textContent?.replace('E', '') || '1';
                const episodeTitle = episodeEl.querySelector('.episode-title')?.textContent || `Episode ${episodeNum}`;
                await API.history.save({
                    id: episodeId,
                    type: 'episode',
                    sourceId: this.currentSeries.sourceId,
                    parentId: this.currentSeries.series_id,
                    progress: duration,
                    duration,
                    data: {
                        title: this.currentSeries.name,
                        subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                        poster: this.currentSeries.cover,
                        sourceId: this.currentSeries.sourceId,
                        seriesId: this.currentSeries.series_id,
                        currentSeason: seasonNum,
                        currentEpisode: episodeNum,
                        manualWatched: true
                    }
                });
                this.episodeWatchStatus.set(episodeId, {
                    item_id: episodeId,
                    progress: duration,
                    duration,
                    watched: true,
                    manually_watched: 1
                });
            } else {
                await API.history.remove(episodeId);
                this.episodeWatchStatus.delete(episodeId);
            }

            this.updateSeriesPlaybackButton();
            this.renderEpisodeWatchStatus(episodeEl);
        } catch (err) {
            console.error('[Series] Could not update episode watch status:', err);
        } finally {
            button.disabled = keepDisabled;
            this.updateSeasonWatchButton(episodeEl.closest('.season-group'));
        }
    }

    async setSeasonWatched(seasonGroup, episodeEls, watched, button) {
        button.disabled = true;
        const episodeButtons = episodeEls.map(ep => ep.querySelector('.episode-watch-toggle'));
        episodeButtons.forEach(episodeButton => { episodeButton.disabled = true; });

        try {
            for (const episodeEl of episodeEls) {
                const id = String(episodeEl.dataset.episodeId);
                if (Boolean(this.episodeWatchStatus.get(id)?.watched) === watched) continue;
                await this.setEpisodeWatched(episodeEl, watched, episodeEl.querySelector('.episode-watch-toggle'), true);
            }
        } finally {
            button.disabled = false;
            episodeButtons.forEach(episodeButton => { episodeButton.disabled = false; });
            this.updateSeasonWatchButton(seasonGroup);
        }
    }

    async setProgressToEpisode(episodeEl, button) {
        if (!episodeEl || !this.currentSeries || !this.currentSeriesInfo) return;

        const episodeNumbers = new Map(
            Object.values(this.currentSeriesInfo.episodes || {}).flat()
                .map(episode => [String(episode.id), Number(episode.episode_num)])
        );
        const allEpisodeEls = [...this.seasonsContainer.querySelectorAll('.episode-item')].sort((a, b) => {
            const seasonDifference = Number(a.closest('.season-group')?.dataset.season) - Number(b.closest('.season-group')?.dataset.season);
            if (seasonDifference) return seasonDifference;
            return episodeNumbers.get(String(a.dataset.episodeId)) - episodeNumbers.get(String(b.dataset.episodeId));
        });
        const targetIndex = allEpisodeEls.indexOf(episodeEl);
        if (targetIndex < 0) return;

        button.disabled = true;
        try {
            // Mark episodes before this one watched to reflect the selected point in the series.
            for (const previousEpisodeEl of allEpisodeEls.slice(0, targetIndex)) {
                const id = String(previousEpisodeEl.dataset.episodeId);
                if (this.episodeWatchStatus.get(id)?.watched) continue;

                await this.setEpisodeWatched(
                    previousEpisodeEl,
                    true,
                    previousEpisodeEl.querySelector('.episode-watch-toggle')
                );
                if (!this.episodeWatchStatus.get(id)?.watched) {
                    throw new Error(`Could not mark episode ${id} as watched`);
                }
            }

            // Clear this episode and later episodes so the normal resume logic selects this one.
            for (const laterEpisodeEl of allEpisodeEls.slice(targetIndex)) {
                const id = String(laterEpisodeEl.dataset.episodeId);
                if (this.episodeWatchStatus.has(id)) {
                    await API.history.remove(id);
                    this.episodeWatchStatus.delete(id);
                    this.renderEpisodeWatchStatus(laterEpisodeEl);
                }
            }

            const episodeId = String(episodeEl.dataset.episodeId);
            const seasonNum = episodeEl.closest('.season-group')?.dataset.season || '1';
            const episode = Object.values(this.currentSeriesInfo.episodes || {})
                .flat()
                .find(item => String(item.id) === episodeId);
            if (!episode) throw new Error(`Episode ${episodeId} was not found in series info`);

            const episodeNum = episode.episode_num || '1';
            const episodeTitle = episode.title || `Episode ${episodeNum}`;
            const duration = this.getEpisodeDurationSeconds(episodeEl, null);
            await API.history.save({
                id: episodeId,
                type: 'episode',
                sourceId: this.currentSeries.sourceId,
                parentId: this.currentSeries.series_id,
                progress: 1,
                duration: duration > 1 ? duration : 0,
                data: {
                    title: this.currentSeries.name,
                    subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                    poster: this.currentSeries.cover,
                    sourceId: this.currentSeries.sourceId,
                    seriesId: this.currentSeries.series_id,
                    currentSeason: seasonNum,
                    currentEpisode: episodeNum
                }
            });

            this.episodeWatchStatus.set(episodeId, {
                item_id: episodeId,
                progress: 1,
                duration: duration > 1 ? duration : 0,
                watched: false
            });
            this.updateSeriesPlaybackButton();
            this.renderEpisodeWatchStatus(episodeEl);
            this.seasonsContainer.querySelectorAll('.season-group').forEach(seasonGroup => {
                this.updateSeasonWatchButton(seasonGroup);
            });
        } catch (err) {
            console.error('[Series] Could not set episode progress:', err);
            alert('Could not set progress to this episode. Please try again.');
        } finally {
            button.disabled = false;
        }
    }

    async resetSeriesProgress() {
        if (!this.currentSeries) return;

        const seriesName = this.currentSeries.name || 'this series';
        if (!window.confirm(`Reset all watch progress for "${seriesName}"? This will mark every episode unwatched.`)) return;

        const button = document.querySelector('.series-reset-progress-btn');
        if (button) button.disabled = true;

        try {
            await API.history.removeSeries(this.currentSeries.sourceId, this.currentSeries.series_id);
            this.episodeWatchStatus.clear();
            this.updateSeriesPlaybackButton();

            this.seasonsContainer.querySelectorAll('.episode-item').forEach(episodeEl => {
                this.renderEpisodeWatchStatus(episodeEl);
            });
            this.seasonsContainer.querySelectorAll('.season-group').forEach(seasonGroup => {
                this.updateSeasonWatchButton(seasonGroup);
            });
        } catch (err) {
            console.error('[Series] Could not reset series watch progress:', err);
            alert('Could not reset watch progress. Please try again.');
        } finally {
            if (button) button.disabled = false;
        }
    }

    renderEpisodeWatchStatus(episodeEl) {
        const id = String(episodeEl.dataset.episodeId);
        const status = this.episodeWatchStatus.get(id);
        const watched = Boolean(status?.watched);
        const inProgress = !watched && status?.progress > 0;
        episodeEl.classList.toggle('watched', watched);
        episodeEl.classList.toggle('in-progress', inProgress);
        episodeEl.querySelector('.episode-watched-badge, .episode-resume-badge')?.remove();

        if (watched) {
            const badge = document.createElement('span');
            badge.className = 'episode-watched-badge';
            badge.title = 'Watched';
            badge.innerHTML = '&#10003; Watched';
            episodeEl.insertBefore(badge, episodeEl.querySelector('.episode-set-progress, .episode-watch-toggle'));
        } else if (inProgress) {
            const badge = document.createElement('span');
            badge.className = 'episode-resume-badge';
            badge.textContent = `Continue · ${this.formatResumeTime(status.progress)}`;
            episodeEl.insertBefore(badge, episodeEl.querySelector('.episode-set-progress, .episode-watch-toggle'));
        }

        const button = episodeEl.querySelector('.episode-watch-toggle');
        button.textContent = `Mark ${watched ? 'unwatched' : 'watched'}`;
        button.title = `Mark ${watched ? 'unwatched' : 'watched'}`;
        button.setAttribute('aria-label', `Mark episode ${watched ? 'unwatched' : 'watched'}`);
    }

    updateSeasonWatchButton(seasonGroup) {
        if (!seasonGroup) return;
        const episodeEls = [...seasonGroup.querySelectorAll('.episode-item')];
        const allWatched = episodeEls.length > 0 && episodeEls.every(ep =>
            this.episodeWatchStatus.get(String(ep.dataset.episodeId))?.watched
        );
        const button = seasonGroup.querySelector('.season-watch-toggle');
        if (button) button.textContent = allWatched ? 'Mark season unwatched' : 'Mark season watched';
        let badge = seasonGroup.querySelector('.season-watched-badge');
        if (allWatched && !badge) {
            badge = document.createElement('span');
            badge.className = 'season-watched-badge';
            badge.innerHTML = '&#10003; Watched';
            seasonGroup.querySelector('.season-header')?.insertBefore(badge, button || null);
        } else if (!allWatched) {
            badge?.remove();
        }
        seasonGroup.classList.toggle('collapsed', allWatched);
    }

    renderSeriesOverviewMetadata(series, seriesInfo) {
        const episodesBySeason = seriesInfo?.episodes || {};
        const seasons = Object.keys(episodesBySeason).filter(season => Array.isArray(episodesBySeason[season]));
        const episodes = seasons.flatMap(season => episodesBySeason[season]);
        const rating = series.rating || seriesInfo?.info?.rating || seriesInfo?.rating;

        let totalRuntimeSeconds = 0;
        let episodesWithDuration = 0;
        episodes.forEach(episode => {
            const duration = this.getEpisodeDurationSecondsFromData(episode);
            if (duration > 0) {
                totalRuntimeSeconds += duration;
                episodesWithDuration++;
            }
        });

        const runtime = episodes.length > 0 && episodesWithDuration === episodes.length
            ? `Runtime: ${this.formatSeriesRuntime(totalRuntimeSeconds)}`
            : 'Runtime unavailable';
        const metadata = [
            rating ? `Rating: ${rating}` : null,
            `${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'}`,
            `${episodes.length} ${episodes.length === 1 ? 'episode' : 'episodes'}`,
            runtime
        ].filter(Boolean);

        document.getElementById('series-overview-meta').textContent = metadata.join(' | ');
    }

    getEpisodeDurationSecondsFromData(episode) {
        const directFields = [episode?.duration_secs, episode?.info?.duration_secs, episode?.durationSeconds];
        const directSeconds = directFields.map(Number).find(value => Number.isFinite(value) && value > 0);
        if (directSeconds) return Math.ceil(directSeconds);

        const durationText = String(episode?.info?.duration || episode?.duration || '').trim();
        if (/^\d+(?:\.\d+)?$/.test(durationText)) return Math.ceil(Number(durationText));

        const match = durationText.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
        if (!match) return 0;
        return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }

    formatSeriesRuntime(totalSeconds) {
        const totalMinutes = Math.floor(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

    getEpisodeDurationSeconds(episodeEl, status) {
        if (Number(status?.duration) > 0) return Math.ceil(Number(status.duration));

        const episodeId = String(episodeEl.dataset.episodeId);
        const allEpisodes = Object.values(this.currentSeriesInfo?.episodes || {}).flat();
        const episode = allEpisodes.find(item => String(item.id) === episodeId);
        const durationFields = [episode?.duration_secs, episode?.info?.duration_secs, episode?.durationSeconds];
        const seconds = durationFields.map(Number).find(value => Number.isFinite(value) && value > 0);
        if (seconds) return Math.ceil(seconds);

        const durationText = String(episode?.info?.duration || episode?.duration || '').trim();
        if (/^\d+(?:\.\d+)?$/.test(durationText)) return Math.ceil(Number(durationText));
        const match = durationText.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
        if (match) {
            return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        }

        // The explicit manualWatched flag preserves this status if the provider omits duration.
        return 1;
    }

    formatResumeTime(seconds) {
        const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
            : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    async toggleFavorite(series, btn) {
        const favKey = `${series.sourceId}:${series.series_id}`;
        const isFav = this.favoriteIds.has(favKey);
        const iconSpan = btn.querySelector('.fav-icon');

        try {
            // Optimistic update
            if (isFav) {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                btn.title = 'Add to Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
                await API.favorites.remove(series.sourceId, series.series_id, 'series');
            } else {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                btn.title = 'Remove from Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
                await API.favorites.add(series.sourceId, series.series_id, 'series');
            }
        } catch (err) {
            console.error('Error toggling favorite:', err);
            // Revert on error
            if (isFav) {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
            } else {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
            }
        }
        this.filterAndRender();
    }
}

window.SeriesPage = SeriesPage;
