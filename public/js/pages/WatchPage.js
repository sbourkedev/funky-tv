/**
 * Watch Page Controller
 * Handles VOD (Movies/Series) playback with streaming service-style UI
 */

class WatchPage {
    constructor(app) {
        this.app = app;

        // Video elements
        this.video = document.getElementById('watch-video');
        this.overlay = document.getElementById('watch-overlay');

        // iOS: ensure inline playback (not fullscreen by default)
        if (this.video) {
            this.video.setAttribute('playsinline', '');
            this.video.setAttribute('webkit-playsinline', '');
        }

        // Top bar
        this.backBtn = document.getElementById('watch-back-btn');
        this.titleEl = document.getElementById('watch-title');
        this.subtitleEl = document.getElementById('watch-subtitle');

        // Controls
        this.centerPlayBtn = document.getElementById('watch-center-play');
        this.playPauseBtn = document.getElementById('watch-play-pause');
        this.skipBackBtn = document.getElementById('watch-skip-back');
        this.skipFwdBtn = document.getElementById('watch-skip-fwd');
        this.previousEpisodeBtn = document.getElementById('watch-previous-episode');
        this.nextEpisodeBtn = document.getElementById('watch-next-episode-button');
        this.muteBtn = document.getElementById('watch-mute');
        this.volumeSlider = document.getElementById('watch-volume');
        this.fullscreenBtn = document.getElementById('watch-fullscreen');
        this.progressSlider = document.getElementById('watch-progress');
        this.progressTooltip = document.getElementById('watch-progress-tooltip');
        this.timeCurrent = document.getElementById('watch-time-current');
        this.timeTotal = document.getElementById('watch-time-total');
        this.scrollHint = document.getElementById('watch-scroll-hint');
        this.loadingSpinner = document.getElementById('watch-loading');

        // Next episode
        this.nextEpisodePanel = document.getElementById('watch-next-episode');
        this.nextEpisodeTitle = document.getElementById('next-episode-title');
        this.nextCountdown = document.getElementById('next-countdown');
        this.nextPlayNowBtn = document.getElementById('next-play-now');
        this.nextCancelBtn = document.getElementById('next-cancel');

        // Details section
        this.posterEl = document.getElementById('watch-poster');
        this.contentTitleEl = document.getElementById('watch-content-title');
        this.yearEl = document.getElementById('watch-year');
        this.ratingEl = document.getElementById('watch-rating');
        this.durationEl = document.getElementById('watch-duration');
        this.descriptionEl = document.getElementById('watch-description');
        this.playBtn = document.getElementById('watch-play-btn');
        this.playBtnText = document.getElementById('watch-play-btn-text');
        this.favoriteBtn = document.getElementById('watch-favorite-btn');

        // Recommended / Episodes
        this.recommendedSection = document.getElementById('watch-recommended');
        this.recommendedGrid = document.getElementById('watch-recommended-grid');
        this.episodesSection = document.getElementById('watch-episodes');
        this.seasonsContainer = document.getElementById('watch-seasons');

        // Captions
        this.captionsBtn = document.getElementById('watch-captions-btn');
        this.captionsMenu = document.getElementById('watch-captions-menu');
        this.captionsList = document.getElementById('watch-captions-list');

        // Transcode Status
        this.transcodeStatusEx = document.getElementById('watch-transcode-status');
        this.qualityBadgeEl = document.getElementById('watch-quality-badge');

        // State
        this.hls = null;
        this.content = null;
        this.contentType = null; // 'movie' or 'series'
        this.seriesInfo = null;
        this.currentSeason = null;
        this.currentEpisode = null;
        this.isFavorite = false;
        this.returnPage = null;
        this.captionsMenuOpen = false;

        // Overlay timer
        this.overlayTimeout = null;
        this.overlayVisible = true;

        // Next episode
        this.nextEpisodeTimeout = null;
        this.nextEpisodeCountdown = 10;
        this.nextEpisodeInterval = null;
        this.nextEpisodeShowing = false;
        this.nextEpisodeDismissed = false;
        this.nextEpisodeCountdownStarted = false;

        // Watch history
        this.historyInterval = null;
        this.progressSaveQueue = Promise.resolve();
        this.isStopping = false;
        this.episodeWatchStatus = new Map();
        this.reloadSnapshotKey = 'nodecast-watch-reload';
        this.lastReloadSnapshotAt = 0;
        this.autoplayBlocked = false;

        this.init();
    }

    init() {
        // iOS Safari: detect and compensate for floating bottom toolbar
        const updateIosUiBottom = () => {
            let uiBottom = 0;
            if (window.visualViewport) {
                const vv = window.visualViewport;
                uiBottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
            }
            document.documentElement.style.setProperty('--ios-ui-bottom', uiBottom + 'px');
        };

        updateIosUiBottom();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateIosUiBottom);
            window.visualViewport.addEventListener('scroll', updateIosUiBottom);
        } else {
            window.addEventListener('resize', updateIosUiBottom);
        }

        // iOS: use custom --vh unit to avoid 100vh issues with dynamic toolbar
        const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
        const watchVideoSection = document.querySelector('.watch-video-section');
        if (isIOS && watchVideoSection) {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
            watchVideoSection.style.height = 'calc(var(--vh) * 100)';
        }

        // Apply safe area + iOS toolbar padding to overlay
        if (this.overlay) {
            this.overlay.style.paddingBottom = 'calc(env(safe-area-inset-bottom, 0px) + var(--ios-ui-bottom, 0px) + 12px)';
        }

        // Back button
        this.backBtn?.addEventListener('click', () => this.goBack());

        // Play/Pause
        this.centerPlayBtn?.addEventListener('click', () => this.togglePlay());
        this.playPauseBtn?.addEventListener('click', () => this.togglePlay());
        this.video?.addEventListener('click', () => this.togglePlay());

        // Skip buttons
        this.skipBackBtn?.addEventListener('click', () => this.skip(-10));
        this.skipFwdBtn?.addEventListener('click', () => this.skip(10));
        this.previousEpisodeBtn?.addEventListener('click', () => this.playAdjacentEpisode(-1));
        this.nextEpisodeBtn?.addEventListener('click', () => this.playAdjacentEpisode(1));

        // Volume
        this.muteBtn?.addEventListener('click', () => this.toggleMute());
        this.volumeSlider?.addEventListener('input', (e) => this.setVolume(e.target.value));

        // Fullscreen
        this.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());

        // Picture-in-Picture
        const pipBtn = document.getElementById('watch-pip');
        pipBtn?.addEventListener('click', () => this.togglePictureInPicture());

        // Overflow Menu
        const overflowBtn = document.getElementById('watch-overflow');
        const overflowMenu = document.getElementById('watch-overflow-menu');

        overflowBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            overflowMenu?.classList.toggle('hidden');
        });

        // Copy Stream URL
        const copyUrlBtn = document.getElementById('watch-copy-url');
        copyUrlBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyStreamUrl();
            overflowMenu?.classList.add('hidden');
        });

        // Close overflow menu when clicking outside
        document.addEventListener('click', (e) => {
            if (overflowMenu && !overflowMenu.classList.contains('hidden') &&
                !overflowMenu.contains(e.target) && e.target !== overflowBtn) {
                overflowMenu.classList.add('hidden');
            }
        });

        // Progress bar
        this.progressSlider?.addEventListener('input', (e) => {
            e.target.style.setProperty('--progress', `${e.target.value}%`);
        });
        this.progressSlider?.addEventListener('change', (e) => this.seek(e.target.value));
        this.progressSlider?.addEventListener('pointermove', (event) => this.updateProgressTooltip(event));
        this.progressSlider?.addEventListener('pointerleave', () => this.hideProgressTooltip());

        window.addEventListener('pagehide', () => {
            this.persistPlaybackSnapshot(true);
            this.saveProgressOnPageHide();
            this.cleanupTranscodeSessionOnPageHide();
        });

        // Video events
        this.video?.addEventListener('timeupdate', () => {
            this.updateProgress();
            this.persistPlaybackSnapshot();
        });
        this.video?.addEventListener('loadedmetadata', () => this.onMetadataLoaded());
        this.video?.addEventListener('durationchange', () => {
            this.updateProgress();
        });
        this.video?.addEventListener('play', () => this.onPlay());
        this.video?.addEventListener('pause', () => this.onPause());
        this.video?.addEventListener('ended', () => this.onEnded());
        this.video?.addEventListener('error', (e) => this.onError(e));
        this.video?.addEventListener('waiting', () => {
            if (!this.autoplayBlocked) this.showLoading();
        });
        this.video?.addEventListener('canplay', () => this.hideLoading());

        // Overlay auto-hide + click to toggle play
        const watchSection = document.querySelector('.watch-video-section');
        watchSection?.addEventListener('mousemove', () => this.showOverlay());
        watchSection?.addEventListener('touchstart', () => this.showOverlay());
        watchSection?.addEventListener('click', (e) => {
            this.showOverlay();
            // Only toggle play if clicking on video area (not controls)
            if (e.target === this.video || e.target === watchSection ||
                e.target.classList.contains('watch-overlay') || e.target === this.overlay) {
                this.togglePlay();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Details section buttons
        this.playBtn?.addEventListener('click', () => this.scrollToVideo());
        this.favoriteBtn?.addEventListener('click', () => this.toggleFavorite());

        // Next episode buttons
        this.nextPlayNowBtn?.addEventListener('click', () => this.playNextEpisode());
        this.nextCancelBtn?.addEventListener('click', () => this.cancelNextEpisode());

        // Captions toggle
        this.captionsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCaptionsMenu();
        });

        // Close captions menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.captionsMenuOpen && !this.captionsMenu?.contains(e.target) && e.target !== this.captionsBtn) {
                this.closeCaptionsMenu();
            }
        });

        // Hide scroll hint after scrolling
        const watchPage = document.getElementById('page-watch');
        watchPage?.addEventListener('scroll', () => {
            if (watchPage.scrollTop > 50) {
                this.scrollHint?.classList.add('hidden');
            } else {
                this.scrollHint?.classList.remove('hidden');
            }
        });
    }

    /**
     * Main entry point - play content
     * @param {Object} content - Movie or episode info
     * @param {string} streamUrl - Stream URL
     */
    async play(content, streamUrl) {
        // Persist the outgoing item before replacing its content metadata.
        if (this.content) await this.stop();

        this.isStopping = false;
        this.content = content;
        this.contentType = content.type;
        this.seriesInfo = content.seriesInfo || null;
        this.currentSeason = content.currentSeason || null;
        this.currentEpisode = content.currentEpisode || null;
        this.updateEpisodeNavigation();
        this.resumeTime = content.resumeTime || 0;
        this.containerExtension = content.containerExtension || 'mp4';
        this.returnPage = content.type === 'movie' ? 'movies' : 'series';

        // Stop any Live TV playback before starting movie/series
        this.app?.player?.stop?.();

        // Reset state
        this.cancelNextEpisode();
        this.nextEpisodeDismissed = false;

        // Navigate to watch page
        this.app.navigateTo('watch', true);

        // Scroll to top
        document.getElementById('page-watch')?.scrollTo(0, 0);

        // Update title bar
        this.titleEl.textContent = content.title || '';
        this.subtitleEl.textContent = content.subtitle || '';

        // Load video
        await this.loadVideo(streamUrl);
        this.persistPlaybackSnapshot(true);

        // Show Now Playing indicator in navbar
        this.showNowPlaying(content.title);

        // Populate details section
        this.renderDetails();

        // Load recommended (movies) or episodes (series)
        if (content.type === 'movie') {
            this.episodesSection?.classList.add('hidden');
            this.recommendedSection?.classList.remove('hidden');
            await this.loadRecommended(content.sourceId, content.categoryId);
        } else {
            this.recommendedSection?.classList.add('hidden');
            this.episodesSection?.classList.remove('hidden');
            await this.loadWatchedEpisodes(content.sourceId, content.seriesId);
            this.renderEpisodes();
        }

        // Check favorite status
        await this.checkFavorite();
        // Show overlay initially
        this.showOverlay();

        // Start watch history tracking
        this.startHistoryTracking();
    }

    async restorePlaybackAfterReload() {
        let snapshot;
        try {
            snapshot = JSON.parse(sessionStorage.getItem(this.reloadSnapshotKey) || 'null');
        } catch (err) {
            console.warn('[WatchPage] Could not read saved playback state:', err);
            return false;
        }

        const savedContent = snapshot?.content;
        if (!savedContent?.sourceId || !savedContent?.id || !['movie', 'series'].includes(savedContent.type)) {
            return false;
        }

        try {
            const content = {
                ...savedContent,
                resumeTime: Math.max(0, Number(snapshot.resumeTime) || 0)
            };
            if (content.type === 'series') {
                content.seriesInfo = await API.proxy.xtream.seriesInfo(content.sourceId, content.seriesId);
            }

            const result = await API.proxy.xtream.getStreamUrl(
                content.sourceId,
                content.id,
                content.type,
                content.containerExtension || 'mp4'
            );
            if (!result?.url) return false;

            await this.play(content, result.url);
            return true;
        } catch (err) {
            console.error('[WatchPage] Could not restore playback after reload:', err);
            return false;
        }
    }

    persistPlaybackSnapshot(force = false) {
        if (!this.content || !this.video || this.isStopping) return;
        if (this.video.ended) {
            sessionStorage.removeItem(this.reloadSnapshotKey);
            return;
        }

        const now = Date.now();
        if (!force && now - this.lastReloadSnapshotAt < 3000) return;

        const content = {};
        [
            'type', 'id', 'title', 'subtitle', 'poster', 'description', 'year', 'rating',
            'sourceId', 'seriesId', 'currentSeason', 'currentEpisode', 'containerExtension', 'categoryId'
        ].forEach(key => {
            if (this.content[key] !== undefined) content[key] = this.content[key];
        });

        const resumeTime = Math.max(0, (Number(this.video.currentTime) || 0) + (this.playbackOffset || 0));
        try {
            sessionStorage.setItem(this.reloadSnapshotKey, JSON.stringify({ content, resumeTime }));
            this.lastReloadSnapshotAt = now;
        } catch (err) {
            console.warn('[WatchPage] Could not save playback state for reload:', err);
        }
    }

    saveProgressOnPageHide() {
        if (!this.content || !this.video || this.isStopping) return;

        const duration = Math.floor(this.knownDuration || this.video.duration);
        const progress = Math.floor((Number(this.video.currentTime) || 0) + (this.playbackOffset || 0));
        if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) return;

        const data = {
            title: this.content.title || 'Unknown Title',
            subtitle: this.content.subtitle || (this.content.type === 'movie' ? 'Movie' : 'Series'),
            poster: this.content.poster,
            sourceId: this.content.sourceId,
            containerExtension: this.containerExtension,
            seriesId: this.content.seriesId || null,
            currentSeason: this.currentSeason || null,
            currentEpisode: this.currentEpisode || null
        };
        const token = localStorage.getItem('authToken');

        fetch('/api/history', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                id: this.content.id,
                type: this.content.type === 'movie' ? 'movie' : 'episode',
                sourceId: this.content.sourceId,
                parentId: this.content.type === 'series' ? this.content.seriesId : null,
                progress,
                duration,
                data
            }),
            keepalive: true
        }).catch(err => console.warn('[History] Could not save progress during page reload:', err));
    }

    cleanupTranscodeSessionOnPageHide() {
        if (!this.currentSessionId) return;

        const sessionId = this.currentSessionId;
        const token = localStorage.getItem('authToken');
        fetch(`/api/transcode/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            keepalive: true
        }).catch(err => console.warn('[WatchPage] Could not clean up transcode session during reload:', err));
        this.currentSessionId = null;
    }

    /**
     * Show Now Playing indicator in navbar
     */
    showNowPlaying(title) {
        const indicator = document.getElementById('now-playing-indicator');
        const textEl = document.getElementById('now-playing-text');
        if (indicator && textEl) {
            textEl.textContent = title || 'Now Playing';
            indicator.classList.remove('hidden');
        }
    }

    /**
     * Hide Now Playing indicator in navbar
     */
    hideNowPlaying() {
        const indicator = document.getElementById('now-playing-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
        }
    }

    /**
     * Start a HLS transcode session
     */
    async startTranscodeSession(url, options = {}) {
        const effectiveOptions = { ...options };
        const seekOffset = Number(effectiveOptions.seekOffset ?? this.resumeTime) || 0;

        // Stream copy can only begin at a keyframe, which can put playback a few
        // seconds away from the saved resume point. Re-encode resumed seeks so
        // FFmpeg can decode and discard frames up to the exact requested time.
        if (seekOffset > 0 && effectiveOptions.accurateSeek && effectiveOptions.videoMode === 'copy') {
            effectiveOptions.videoMode = 'encode';
            this.updateTranscodeStatus('transcoding', 'Transcoding (Accurate Seek)');
            console.log('[WatchPage] Enabling video encoding for accurate seek:', seekOffset);
        }

        effectiveOptions.seekOffset = seekOffset;
        this.currentTranscodeOptions = { ...effectiveOptions };
        try {
            console.log('[WatchPage] Starting HLS transcode session...', effectiveOptions);
            const res = await fetch('/api/transcode/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, ...effectiveOptions })
            });
            if (!res.ok) throw new Error('Failed to start session');
            const session = await res.json();
            this.currentSessionId = session.sessionId;
            this.playbackOffset = seekOffset;
            if (this.playbackOffset > 0) this.resumeTime = 0;
            this.updateProgress();
            return session.playlistUrl;
        } catch (err) {
            console.error('[WatchPage] Session start failed:', err);
            // Fallback to direct transcode if session fails
            return '/api/transcode?url=' + encodeURIComponent(url);
        }
    }
    /**
     * Stop and cleanup current transcode session
     */
    async stopTranscodeSession() {
        if (this.currentSessionId) {
            const sessionId = this.currentSessionId;
            this.currentSessionId = null;
            console.log('[WatchPage] Stopping transcode session:', sessionId);
            try {
                await fetch(`/api/transcode/${sessionId}`, { method: 'DELETE' });
            } catch (err) {
                console.error('Failed to stop session:', err);
            }
        }
    }

    async updateTranscodeStatus(mode, text) {
        if (!this.transcodeStatusEx) return;

        this.transcodeStatusEx.className = 'transcode-status'; // Reset classes

        if (mode === 'hidden') {
            this.transcodeStatusEx.classList.add('hidden');
            return;
        }

        this.transcodeStatusEx.textContent = text || mode;
        this.transcodeStatusEx.classList.add(mode);

        // Ensure it's visible
        this.transcodeStatusEx.classList.remove('hidden');
    }

    /**
     * Get quality label from video height
     */
    getQualityLabel(height) {
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height > 0) return `${height}p`;
        return null;
    }

    /**
     * Update quality badge display
     */
    updateQualityBadge() {
        if (!this.qualityBadgeEl) return;

        if (this.currentStreamInfo?.height > 0) {
            this.qualityBadgeEl.textContent = this.getQualityLabel(this.currentStreamInfo.height);
            this.qualityBadgeEl.classList.remove('hidden');
        } else {
            this.qualityBadgeEl.classList.add('hidden');
        }
    }

    async loadVideo(url) {
        // Store the URL for copy functionality
        this.currentUrl = url;
        this.autoplayBlocked = false;

        this.knownDuration = null;
        this.resumeAfterSeek = null;
        this.playbackOffset = 0;
        this.currentTranscodeOptions = null;

        // Show loading spinner
        this.showLoading();

        // Get settings for proxy/transcode
        let settings = {};
        try {
            settings = await API.settings.get();
        } catch (e) {
            console.warn('Could not load settings');
        }

        // Detect stream type
        const looksLikeHls = url.includes('.m3u8') || url.includes('m3u8');
        const isRawTs = url.includes('.ts') && !url.includes('.m3u8');
        const isDirectVideo = url.includes('.mp4') || url.includes('.mkv') || url.includes('.avi');

        let probeInfo = null;

        // Priority 0: Auto Transcode (Smart) - probe first, then decide
        if (settings.autoTranscode) {
            console.log('[WatchPage] Auto Transcode enabled. Probing stream...');
            try {
                const ua = settings.userAgentPreset === 'custom' ? settings.userAgentCustom : settings.userAgentPreset;
                const probeRes = await fetch(`/api/probe?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua || '')}`);
                const info = await probeRes.json();
                probeInfo = info;
                console.log(`[WatchPage] Probe result: video=${info.video}, audio=${info.audio}, ${info.width}x${info.height}, compatible=${info.compatible}`);

                // Store early probe info for quality display
                this.currentStreamInfo = info;
                this.updateQualityBadge();

                if (info.needsTranscode || settings.upscaleEnabled) {
                    this.knownDuration = Number.isFinite(Number(info.duration)) ? Number(info.duration) : null;
                    console.log(`[WatchPage] Auto: Using HLS transcode session (${settings.upscaleEnabled ? 'Upscaling' : 'Incompatible audio/video'})`);

                    // Heuristic: If video is h264/compat, copy video. Usage: Audio fix. 
                    // BUT: If upscaling is enabled, we MUST encode.
                    const videoMode = (info.video && info.video.includes('h264') && !settings.upscaleEnabled) ? 'copy' : 'encode';
                    const statusText = videoMode === 'copy' ? 'Transcoding (Audio)' : (settings.upscaleEnabled ? 'Upscaling' : 'Transcoding (Video)');
                    const statusMode = settings.upscaleEnabled ? 'upscaling' : 'transcoding';

                    this.updateTranscodeStatus(statusMode, statusText);
                    const playlistUrl = await this.startTranscodeSession(url, {
                        videoMode,
                        seekOffset: this.resumeTime,
                        accurateSeek: this.resumeTime > 0, // Accurate when resuming a saved position
                        videoCodec: info.video,
                        audioCodec: info.audio,
                        audioChannels: info.audioChannels
                    });
                    this.playHls(playlistUrl);
                    this.setVolumeFromStorage();
                    return;
                } else if (info.needsRemux) {
                    // Remux (container swap) currently doesn't use session logic, uses direct stream
                    // TODO: Move remux to session logic if seeking is needed for TS files
                    console.log('[WatchPage] Auto: Using remux (.ts container)');
                    this.updateTranscodeStatus('remuxing', 'Remux (Auto)');
                    const finalUrl = `/api/remux?url=${encodeURIComponent(url)}`;
                    this.video.src = finalUrl;
                    this.video.play().catch(e => this.handlePlaybackStartError(e));
                    this.setVolumeFromStorage();
                    return;
                }
                // Compatible - fall through to normal playback
                console.log('[WatchPage] Auto: Using normal playback (compatible)');
            } catch (err) {
                console.warn('[WatchPage] Probe failed, using normal playback:', err.message);
                // Continue with normal playback on probe failure
            }
        }

        // Priority 1: Force Video Transcode (Full) or Upscaling
        if (settings.forceVideoTranscode || settings.upscaleEnabled) {
            if (!probeInfo) {
                try {
                    const ua = settings.userAgentPreset === 'custom' ? settings.userAgentCustom : settings.userAgentPreset;
                    const probeRes = await fetch(`/api/probe?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua || '')}`);
                    probeInfo = await probeRes.json();
                } catch (err) {
                    console.warn('[WatchPage] Could not determine source duration:', err.message);
                }
            }
            this.knownDuration = Number.isFinite(Number(probeInfo?.duration)) ? Number(probeInfo.duration) : null;
            const statusText = settings.upscaleEnabled ? 'Upscaling' : 'Transcoding (Video)';
            const statusMode = settings.upscaleEnabled ? 'upscaling' : 'transcoding';
            console.log(`[WatchPage] ${statusText} enabled. Starting session (encode)...`);
            this.updateTranscodeStatus(statusMode, statusText);
            const playlistUrl = await this.startTranscodeSession(url, {
                videoMode: 'encode',
                seekOffset: this.resumeTime
            });
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
            return;
        }

        if (settings.forceTranscode) {
            console.log('[WatchPage] Force Audio Transcode enabled. Starting session (copy)...');
            this.updateTranscodeStatus('transcoding', 'Transcoding (Audio)');

            // Probe to get video codec for HEVC tag handling
            let videoCodec = 'unknown';
            try {
                const ua = settings.userAgentPreset === 'custom' ? settings.userAgentCustom : settings.userAgentPreset;
                const probeRes = await fetch(`/api/probe?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua || '')}`);
                const info = await probeRes.json();
                this.knownDuration = Number.isFinite(Number(info.duration)) ? Number(info.duration) : null;
                videoCodec = info.video;
            } catch (e) { console.warn('Probe failed for force audio, assuming h264'); }

            const playlistUrl = await this.startTranscodeSession(url, {
                videoMode: 'copy',
                videoCodec,
                seekOffset: this.resumeTime,
                accurateSeek: this.resumeTime > 0
            });
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
            return;
        }

        // Priority 2: Force Remux for raw TS streams
        if (settings.forceRemux && isRawTs) {
            console.log('[WatchPage] Force Remux enabled');
            this.updateTranscodeStatus('remuxing', 'Remux (Force)');
            const finalUrl = `/api/remux?url=${encodeURIComponent(url)}`;
            this.video.src = finalUrl;
            this.video.play().catch(e => this.handlePlaybackStartError(e));
            this.setVolumeFromStorage();
            return;
        }

        // Determine if proxy is needed
        const proxyRequiredDomains = ['pluto.tv'];
        const needsProxy = settings.forceProxy || proxyRequiredDomains.some(domain => url.includes(domain));
        const finalUrl = needsProxy ? `/api/proxy/stream?url=${encodeURIComponent(url)}` : url;

        console.log('[WatchPage] Playing:', { url, needsProxy, looksLikeHls });

        // Use HLS.js for HLS streams
        if (looksLikeHls && Hls.isSupported()) {
            this.updateTranscodeStatus('direct', 'Direct HLS');
            this.playHls(finalUrl);
        } else {
            // Direct playback for mp4/mkv/avi
            this.updateTranscodeStatus('direct', 'Direct Play');
            this.video.src = finalUrl;
            this.video.play().catch(e => this.handlePlaybackStartError(e));
        }

        this.setVolumeFromStorage();
    }

    /**
     * Play HLS stream using Hls.js
     */
    playHls(url) {
        if (this.hls) {
            this.hls.destroy();
        }

        this.hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            startLevel: -1,
            enableWorker: true,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        // Listen for subtitle track updates
        this.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
            console.log('[WatchPage] Subtitle tracks updated:', data.subtitleTracks);
            // Wait a moment for native text tracks to populate
            setTimeout(() => this.updateCaptionsTracks(), 100);
        });

        this.hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (event, data) => {
            console.log('[WatchPage] Subtitle track switched:', data);
        });

        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const shouldPlay = this.resumeAfterSeek ?? true;
            if (typeof this.resumeAfterSeek === 'boolean') {
                this.pendingSeekTarget = null;
                this.updateProgress();
            }
            this.resumeAfterSeek = null;
            if (shouldPlay) {
                this.video.play().catch(e => this.handlePlaybackStartError(e));
            }
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error('[WatchPage] HLS fatal error:', data);
                // Try proxy on CORS error (only if not already proxied/transcoded)
                // Note: Transcoded streams are local, so no CORS issues usually
                if (!url.startsWith('/api/') && (data.type === Hls.ErrorTypes.NETWORK_ERROR)) {
                    console.log('[WatchPage] Retrying via proxy...');
                    this.playHls(`/api/proxy/stream?url=${encodeURIComponent(this.currentUrl)}`);
                } else {
                    this.hls.destroy();
                }
            }
        });
    }

    setVolumeFromStorage() {
        const savedVolume = localStorage.getItem('nodecast-volume') || '80';
        this.video.volume = parseInt(savedVolume) / 100;
        if (this.volumeSlider) this.volumeSlider.value = savedVolume;
    }

    async stop() {
        this.isStopping = true;
        sessionStorage.removeItem(this.reloadSnapshotKey);
        this.pendingSeekTarget = null;

        // Stop history tracking and save final progress
        this.stopHistoryTracking();
        await this.saveProgress(false, true);

        // Cleanup transcode session if exists
        this.stopTranscodeSession();
        this.updateTranscodeStatus('hidden');

        // Hide quality badge
        this.currentStreamInfo = null;
        if (this.qualityBadgeEl) {
            this.qualityBadgeEl.classList.add('hidden');
        }

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.video) {
            this.video.pause();
            this.video.src = '';
            this.video.load();
        }

        this.hideNowPlaying();
        this.content = null;
        this.contentType = null;
        this.playbackOffset = 0;
    }

    // === Playback Controls ===

    togglePlay() {
        if (this.video.paused) {
            this.autoplayBlocked = false;
            this.video.play().catch(e => this.handlePlaybackStartError(e));
        } else {
            this.video.pause();
        }
    }

    handlePlaybackStartError(error) {
        if (error?.name === 'AbortError') return;
        if (error?.name === 'NotAllowedError') {
            this.autoplayBlocked = true;
            this.hideLoading();
            this.onPause();
            return;
        }
        console.error('[WatchPage] Playback start failed:', error);
    }

    skip(seconds) {
        if (this.video) {
            if (Number.isFinite(this.knownDuration) && this.knownDuration > 0) {
                const sourceTime = this.video.currentTime + (this.playbackOffset || 0) + seconds;
                this.seek((sourceTime / this.knownDuration) * 100);
                return;
            }
            this.video.currentTime = Math.max(0, Math.min(this.video.currentTime + seconds, this.video.duration || 0));
        }
    }

    seek(percent) {
        if (!this.video || !Number.isFinite(this.knownDuration) || this.knownDuration <= 0) return;

        const targetTime = Math.min(this.knownDuration, Math.max(0, Number(percent) / 100 * this.knownDuration));
        this.pendingSeekTarget = targetTime;
        if (this.progressSlider) {
            this.progressSlider.value = (targetTime / this.knownDuration) * 100;
            this.progressSlider.style.setProperty('--progress', `${this.progressSlider.value}%`);
        }
        const localTarget = targetTime - (this.playbackOffset || 0);
        let isBuffered = false;
        for (let i = 0; i < this.video.seekable.length; i++) {
            if (localTarget >= this.video.seekable.start(i) && localTarget <= this.video.seekable.end(i)) {
                isBuffered = true;
                break;
            }
        }
        if (!isBuffered) {
            for (let i = 0; i < this.video.buffered.length; i++) {
                if (localTarget >= this.video.buffered.start(i) && localTarget <= this.video.buffered.end(i)) {
                    isBuffered = true;
                    break;
                }
            }
        }

        if (this.currentSessionId && !isBuffered) {
            this.restartTranscodeAt(targetTime);
            return;
        }

        if (Number.isFinite(this.video.duration) && localTarget >= 0 && localTarget <= this.video.duration) {
            if (Math.abs(this.video.currentTime - localTarget) < 0.25) {
                this.pendingSeekTarget = null;
                this.updateProgress();
                return;
            }
            const onSeeked = () => {
                this.video.removeEventListener('seeked', onSeeked);
                if (this.pendingSeekTarget === targetTime) {
                    this.pendingSeekTarget = null;
                    this.updateProgress();
                }
            };
            this.video.addEventListener('seeked', onSeeked);
            this.video.currentTime = localTarget;
        } else {
            this.pendingSeekTarget = null;
            this.updateProgress();
        }
    }

    updateProgressTooltip(event) {
        const duration = Number.isFinite(this.knownDuration) && this.knownDuration > 0
            ? this.knownDuration
            : this.video?.duration;
        if (!this.progressSlider || !this.progressTooltip || !Number.isFinite(duration) || duration <= 0 || event.pointerType === 'touch') {
            this.hideProgressTooltip();
            return;
        }

        const sliderRect = this.progressSlider.getBoundingClientRect();
        const wrapperRect = this.progressSlider.parentElement.getBoundingClientRect();
        if (!sliderRect.width || !wrapperRect.width) {
            this.hideProgressTooltip();
            return;
        }

        const ratio = Math.min(1, Math.max(0, (event.clientX - sliderRect.left) / sliderRect.width));
        this.progressTooltip.textContent = this.formatTime(ratio * duration);
        const tooltipHalfWidth = this.progressTooltip.offsetWidth / 2;
        const x = Math.min(wrapperRect.width - tooltipHalfWidth, Math.max(tooltipHalfWidth, event.clientX - wrapperRect.left));

        this.progressTooltip.style.left = `${x}px`;
        this.progressTooltip.classList.add('visible');
        this.progressTooltip.setAttribute('aria-hidden', 'false');
    }

    hideProgressTooltip() {
        this.progressTooltip?.classList.remove('visible');
        this.progressTooltip?.setAttribute('aria-hidden', 'true');
    }

    async restartTranscodeAt(targetTime) {
        if (!this.currentSessionId || !this.currentUrl) return;

        const shouldPlay = !this.video.paused;
        const options = { ...(this.currentTranscodeOptions || {}), seekOffset: targetTime };
        this.video.pause();
        this.showLoading();
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.removeAttribute('src');
        this.video.load();
        await this.stopTranscodeSession();

        const playlistUrl = await this.startTranscodeSession(this.currentUrl, options);
        this.resumeAfterSeek = shouldPlay;
        this.playHls(playlistUrl);
    }

    toggleMute() {
        if (this.video) {
            this.video.muted = !this.video.muted;
            this.updateVolumeUI();
        }
    }

    setVolume(value) {
        if (this.video) {
            this.video.volume = value / 100;
            this.video.muted = false;
            localStorage.setItem('nodecast-volume', value);
            this.updateVolumeUI();
        }
    }

    toggleFullscreen() {
        const container = document.querySelector('.watch-video-section');
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

        if (isFullscreen) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else {
            if (container?.requestFullscreen) {
                container.requestFullscreen();
            } else if (container?.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (this.video?.webkitEnterFullscreen) {
                // iOS Safari: use native video fullscreen
                this.video.webkitEnterFullscreen();
            }
        }
    }

    async togglePictureInPicture() {
        try {
            // Standard PiP API (Chrome, Edge, Firefox)
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled && this.video.readyState >= 2) {
                await this.video.requestPictureInPicture();
            }
            // Safari fallback using webkitPresentationMode
            else if (typeof this.video.webkitSetPresentationMode === 'function') {
                const mode = this.video.webkitPresentationMode;
                this.video.webkitSetPresentationMode(mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
            }
        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                console.error('Picture-in-Picture error:', err);
            }
        }
    }

    /**
     * Copy current stream URL to clipboard
     */
    copyStreamUrl() {
        if (!this.currentUrl) {
            console.warn('[WatchPage] No stream URL to copy');
            return;
        }

        let streamUrl = this.currentUrl;

        // If it's a relative URL, make it absolute
        if (streamUrl.startsWith('/')) {
            streamUrl = window.location.origin + streamUrl;
        }

        const showPromptFallback = () => {
            prompt('Copy this URL:', streamUrl);
        };

        // navigator.clipboard is only available in secure contexts (HTTPS/localhost)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(streamUrl).then(() => {
                // Show brief feedback
                const btn = document.getElementById('watch-copy-url');
                if (btn) {
                    btn.textContent = '✓ Copied!';
                    setTimeout(() => {
                        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Copy Stream URL`;
                    }, 1500);
                }
                console.log('[WatchPage] Stream URL copied:', streamUrl);
            }).catch(() => {
                showPromptFallback();
            });
        } else {
            // Fallback for insecure contexts (HTTP)
            showPromptFallback();
        }
    }

    // === UI Updates ===

    updateProgress() {
        if (!this.video) return;

        const duration = Number.isFinite(this.knownDuration) && this.knownDuration > 0
            ? this.knownDuration
            : this.video.duration;
        const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
        const currentTime = Number.isFinite(this.pendingSeekTarget)
            ? this.pendingSeekTarget
            : (Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0)
                + (this.playbackOffset || 0);

        if (this.timeCurrent) this.timeCurrent.textContent = this.formatTime(currentTime);
        if (this.timeTotal) this.timeTotal.textContent = hasFiniteDuration ? this.formatTime(duration) : '--:--';
        if (this.progressSlider) {
            this.progressSlider.disabled = !hasFiniteDuration;
            const progressPercent = hasFiniteDuration
                ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
                : 0;
            this.progressSlider.value = progressPercent;
            this.progressSlider.style.setProperty('--progress', `${progressPercent}%`);
        }

        if (!hasFiniteDuration) return;

        // Show "Up Next" near the estimated start of credits.
        // Only show if auto-play next episode is enabled
        const autoPlayEnabled = this.app?.player?.settings?.autoPlayNextEpisode;
        if (autoPlayEnabled && this.contentType === 'series' && this.seriesInfo && !this.nextEpisodeShowing && !this.nextEpisodeDismissed) {
            const duration = this.knownDuration || this.video.duration;
            const currentTime = this.video.currentTime + (this.playbackOffset || 0);

            // Only proceed if we have reliable duration data
            if (isFinite(duration) && duration >= 180 && currentTime >= 120) {
                const timeRemaining = duration - currentTime;
                const creditsThreshold = 60; // Estimate credits start as one minute before the end.

                if (timeRemaining <= creditsThreshold && timeRemaining > 0) {
                    const nextEp = this.getNextEpisode();
                    if (nextEp) {
                        this.nextEpisodeShowing = true;
                        this.showNextEpisodePanel(nextEp);
                    }
                }

                // Give viewers the estimated credits window, then start the existing
                // 10-second autoplay countdown near the episode's end.
                if (this.nextEpisodeShowing && timeRemaining <= 10 && timeRemaining > 0) {
                    this.startNextEpisodeCountdown();
                }
            }
        }
    }

    onMetadataLoaded() {
        this.updateProgress();

        // Detect resolution
        if (this.video && this.video.videoHeight > 0) {
            this.currentStreamInfo = {
                width: this.video.videoWidth,
                height: this.video.videoHeight
            };
            this.updateQualityBadge();
        }

        // Handle resumption
        if (this.resumeTime > 0 && this.video) {
            const duration = this.knownDuration || this.video.duration;
            // Only resume if not near the end (95%)
            if (!duration || this.resumeTime < duration * 0.95) {
                console.log(`[WatchPage] Resuming at ${this.resumeTime}s`);
                this.video.currentTime = this.resumeTime;
            }
            this.resumeTime = 0; // Reset after use
        }

        // Reflect the resume position as soon as the media timestamp is applied.
        this.updateProgress();
    }

    onPlay() {
        this.autoplayBlocked = false;
        // Update play/pause button icons
        this.playPauseBtn?.querySelector('.icon-play')?.classList.add('hidden');
        this.playPauseBtn?.querySelector('.icon-pause')?.classList.remove('hidden');
        this.centerPlayBtn?.classList.remove('show');

        // Start overlay auto-hide
        this.startOverlayTimer();
    }

    onPause() {
        this.playPauseBtn?.querySelector('.icon-play')?.classList.remove('hidden');
        this.playPauseBtn?.querySelector('.icon-pause')?.classList.add('hidden');
        this.centerPlayBtn?.classList.add('show');

        // Keep overlay visible when paused
        this.showOverlay();
        clearTimeout(this.overlayTimeout);
    }

    onEnded() {
        sessionStorage.removeItem(this.reloadSnapshotKey);
        if (this.contentType === 'series' || this.contentType === 'movie') this.saveProgress(true);

        // For series, show next episode panel if not already showing and auto-play is enabled
        const autoPlayEnabled = this.app?.player?.settings?.autoPlayNextEpisode;
        if (autoPlayEnabled && this.contentType === 'series' && this.seriesInfo && !this.nextEpisodeShowing && !this.nextEpisodeDismissed) {
            const nextEp = this.getNextEpisode();
            if (nextEp) {
                this.nextEpisodeShowing = true;
                this.showNextEpisodePanel(nextEp);
            }
        }
        if (this.nextEpisodeShowing && !this.nextEpisodeDismissed) this.startNextEpisodeCountdown();
    }

    onError(e) {
        // Only log actual fatal errors, not benign stream recovery events
        const error = this.video?.error;
        if (error && error.code) {
            console.error('[WatchPage] Video error:', error.code, error.message);
        }
    }

    updateVolumeUI() {
        const isMuted = this.video?.muted || this.video?.volume === 0;
        this.muteBtn?.querySelector('.icon-vol')?.classList.toggle('hidden', isMuted);
        this.muteBtn?.querySelector('.icon-muted')?.classList.toggle('hidden', !isMuted);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // === Loading Spinner ===

    showLoading() {
        this.loadingSpinner?.classList.add('show');
        this.centerPlayBtn?.classList.remove('show');
    }

    hideLoading() {
        this.loadingSpinner?.classList.remove('show');
    }

    // === Captions ===

    toggleCaptionsMenu() {
        if (this.captionsMenuOpen) {
            this.closeCaptionsMenu();
        } else {
            this.updateCaptionsTracks();
            this.captionsMenu?.classList.remove('hidden');
            this.captionsMenuOpen = true;
        }
    }

    closeCaptionsMenu() {
        this.captionsMenu?.classList.add('hidden');
        this.captionsMenuOpen = false;
    }

    updateCaptionsTracks() {
        if (!this.captionsList || !this.video) return;

        // Build list of available text tracks
        const tracks = this.video.textTracks;
        let html = '<button class="captions-option" data-index="-1">Off</button>';

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                const label = track.label || track.language || `Track ${i + 1}`;
                const isActive = track.mode === 'showing';
                html += `<button class="captions-option ${isActive ? 'active' : ''}" data-index="${i}">${label}</button>`;
            }
        }

        // Check if any track is active, if not mark "Off" as active
        let anyActive = false;
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].mode === 'showing') anyActive = true;
        }
        if (!anyActive) {
            html = html.replace('class="captions-option"', 'class="captions-option active"');
        }

        this.captionsList.innerHTML = html;

        // Add click handlers
        this.captionsList.querySelectorAll('.captions-option').forEach(btn => {
            btn.addEventListener('click', () => this.selectCaptionTrack(parseInt(btn.dataset.index)));
        });
    }

    selectCaptionTrack(index) {
        if (!this.video) return;

        const tracks = this.video.textTracks;

        // Disable all tracks
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'hidden';
        }

        // Enable selected track
        if (index >= 0 && index < tracks.length) {
            tracks[index].mode = 'showing';
        }

        // Update UI
        this.updateCaptionsTracks();
        this.closeCaptionsMenu();
    }

    // === Overlay Auto-Hide ===

    showOverlay() {
        this.overlay?.classList.remove('hidden');
        this.overlayVisible = true;
        this.startOverlayTimer();
    }

    hideOverlay() {
        if (!this.video?.paused) {
            this.overlay?.classList.add('hidden');
            this.overlayVisible = false;
        }
    }

    startOverlayTimer() {
        clearTimeout(this.overlayTimeout);
        this.overlayTimeout = setTimeout(() => this.hideOverlay(), 3000);
    }

    // === Keyboard Shortcuts ===

    handleKeyboard(e) {
        // Only handle when watch page is active
        const watchPage = document.getElementById('page-watch');
        if (!watchPage?.classList.contains('active')) return;

        // Don't handle if typing in input
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                this.togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.skip(-10);
                this.showOverlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.skip(10);
                this.showOverlay();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.setVolume(Math.min(100, parseInt(this.volumeSlider.value) + 10));
                this.volumeSlider.value = Math.min(100, parseInt(this.volumeSlider.value) + 10);
                this.showOverlay();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.setVolume(Math.max(0, parseInt(this.volumeSlider.value) - 10));
                this.volumeSlider.value = Math.max(0, parseInt(this.volumeSlider.value) - 10);
                this.showOverlay();
                break;
            case 'f':
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case 'm':
                e.preventDefault();
                this.toggleMute();
                this.showOverlay();
                break;
            case 'Escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    this.goBack();
                }
                break;
        }
    }

    // === Details Section ===

    renderDetails() {
        if (!this.content) return;

        const isChannel = this.content.type === 'channel' || !this.content.type; // Default to channel if unknown
        const fallback = isChannel ? '/img/placeholder.png' : '/img/poster-placeholder.jpg';

        this.posterEl.onerror = () => {
            this.posterEl.onerror = null;
            this.posterEl.src = fallback;
        };
        this.posterEl.src = this.content.poster || fallback;
        this.posterEl.alt = this.content.title || '';
        this.contentTitleEl.textContent = this.content.title || '';
        this.yearEl.textContent = this.content.year || '';
        this.ratingEl.textContent = this.content.rating ? `★ ${this.content.rating}` : '';
        this.descriptionEl.textContent = this.content.description || '';

        // Update play button text
        if (this.playBtnText) {
            this.playBtnText.textContent = 'Play';
        }
    }

    async checkFavorite() {
        if (!this.content) return;

        try {
            const itemId = this.contentType === 'movie' ? this.content.id : this.content.seriesId;
            const itemType = this.contentType === 'movie' ? 'movie' : 'series';
            const result = await API.favorites.check(this.content.sourceId, itemId, itemType);
            this.isFavorite = result?.isFavorite || false;
            this.updateFavoriteUI();
        } catch (e) {
            console.warn('Could not check favorite status');
        }
    }

    async toggleFavorite() {
        if (!this.content) return;

        const itemId = this.contentType === 'movie' ? this.content.id : this.content.seriesId;
        const itemType = this.contentType === 'movie' ? 'movie' : 'series';

        try {
            if (this.isFavorite) {
                await API.favorites.remove(this.content.sourceId, itemId, itemType);
                this.isFavorite = false;
            } else {
                await API.favorites.add(this.content.sourceId, itemId, itemType);
                this.isFavorite = true;
            }
            this.updateFavoriteUI();
        } catch (e) {
            console.error('Error toggling favorite:', e);
        }
    }

    updateFavoriteUI() {
        const outlineIcon = this.favoriteBtn?.querySelector('.icon-fav-outline');
        const filledIcon = this.favoriteBtn?.querySelector('.icon-fav-filled');

        outlineIcon?.classList.toggle('hidden', this.isFavorite);
        filledIcon?.classList.toggle('hidden', !this.isFavorite);
    }

    scrollToVideo() {
        document.getElementById('page-watch')?.scrollTo({ top: 0, behavior: 'smooth' });
        if (this.video?.paused) {
            this.autoplayBlocked = false;
            this.video.play().catch(e => this.handlePlaybackStartError(e));
        }
    }

    // === Recommended Movies ===

    async loadRecommended(sourceId, categoryId) {
        if (!sourceId || !categoryId) {
            this.recommendedSection?.classList.add('hidden');
            return;
        }

        try {
            const movies = await API.proxy.xtream.vodStreams(sourceId, categoryId);
            if (!movies || movies.length === 0) {
                this.recommendedSection?.classList.add('hidden');
                return;
            }

            // Filter out current movie, take first 12
            const filtered = movies
                .filter(m => m.stream_id !== this.content?.id)
                .slice(0, 12);

            this.renderRecommendedGrid(filtered, sourceId);
        } catch (e) {
            console.error('Error loading recommended:', e);
            this.recommendedSection?.classList.add('hidden');
        }
    }

    renderRecommendedGrid(movies, sourceId) {
        if (!this.recommendedGrid) return;

        this.recommendedGrid.innerHTML = movies.map(movie => `
            <div class="watch-recommended-card" data-id="${movie.stream_id}" data-source="${sourceId}">
                <img src="${movie.stream_icon || movie.cover || '/img/placeholder.png'}" 
                     alt="${movie.name}" 
                     onerror="this.onerror=null;this.src='/img/placeholder.png'" loading="lazy">
                <p>${movie.name}</p>
            </div>
        `).join('');

        // Click handlers
        this.recommendedGrid.querySelectorAll('.watch-recommended-card').forEach(card => {
            card.addEventListener('click', () => this.playRecommendedMovie(card.dataset.id, parseInt(card.dataset.source)));
        });
    }

    async playRecommendedMovie(streamId, sourceId) {
        try {
            // Fetch movie details
            const movies = await API.proxy.xtream.vodStreams(sourceId);
            const movie = movies?.find(m => m.stream_id == streamId);

            if (!movie) return;

            const container = movie.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(sourceId, streamId, 'movie', container);

            if (result?.url) {
                this.play({
                    type: 'movie',
                    id: movie.stream_id,
                    title: movie.name,
                    poster: movie.stream_icon || movie.cover,
                    description: movie.plot || '',
                    year: movie.year,
                    rating: movie.rating,
                    sourceId: sourceId,
                    categoryId: movie.category_id
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing recommended movie:', e);
        }
    }

    // === Series Episodes ===

    renderEpisodes() {
        if (!this.seriesInfo?.episodes || !this.seasonsContainer) return;

        const seasons = Object.keys(this.seriesInfo.episodes).sort((a, b) => parseInt(a) - parseInt(b));

        this.seasonsContainer.innerHTML = seasons.map(seasonNum => {
            const episodes = this.seriesInfo.episodes[seasonNum];
            const isCurrentSeason = parseInt(seasonNum) === parseInt(this.currentSeason);

            return `
                <div class="watch-season-group">
                    <div class="watch-season-header ${isCurrentSeason ? '' : 'collapsed'}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                        </svg>
                        <span class="watch-season-name">Season ${seasonNum}</span>
                        <span class="watch-season-count">${episodes.length} episodes</span>
                    </div>
                    <div class="watch-episode-list">
                        ${episodes.map(ep => {
                const isActive = parseInt(seasonNum) === parseInt(this.currentSeason) &&
                    parseInt(ep.episode_num) === parseInt(this.currentEpisode);
                const status = this.episodeWatchStatus.get(String(ep.id));
                const isWatched = Boolean(status?.watched);
                const inProgress = !isWatched && status?.progress > 0;
                return `
                                <div class="watch-episode-item ${isActive ? 'active' : ''} ${isWatched ? 'watched' : ''} ${inProgress ? 'in-progress' : ''}" 
                                     data-episode-id="${ep.id}" 
                                     data-season="${seasonNum}"
                                     data-episode="${ep.episode_num}"
                                     data-container="${ep.container_extension || 'mp4'}">
                                    <span class="watch-episode-num">E${ep.episode_num}</span>
                                    <span class="watch-episode-title">${ep.title || `Episode ${ep.episode_num}`}</span>
                                    <span class="watch-episode-duration">${ep.duration || ''}</span>
                                    ${isWatched ? '<span class="episode-watched-badge" title="Watched">&#10003; Watched</span>' : ''}
                                    ${inProgress ? `<span class="episode-resume-badge">Continue &middot; ${this.formatResumeTime(status.progress)}</span>` : ''}
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        }).join('');

        // Season header toggle
        this.seasonsContainer.querySelectorAll('.watch-season-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
            });
        });

        // Episode click handlers
        this.seasonsContainer.querySelectorAll('.watch-episode-item').forEach(ep => {
            ep.addEventListener('click', () => this.playEpisodeFromList(ep));
        });
    }

    async loadWatchedEpisodes(sourceId, seriesId) {
        this.episodeWatchStatus = new Map();
        if (!sourceId || !seriesId) return;

        try {
            const progressRows = await API.history.getSeriesEpisodeProgress(sourceId, seriesId);
            this.episodeWatchStatus = new Map(progressRows.map(row => [String(row.item_id), row]));
        } catch (err) {
            console.warn('[WatchPage] Could not load watched episode status:', err.message);
        }
    }

    updateEpisodeWatchStatus(episodeId, status) {
        const id = String(episodeId);
        this.episodeWatchStatus.set(id, status);
        this.seasonsContainer?.querySelectorAll('.watch-episode-item').forEach(item => {
            if (item.dataset.episodeId !== id) return;
            item.classList.toggle('watched', Boolean(status.watched));
            const inProgress = !status.watched && status.progress > 0;
            item.classList.toggle('in-progress', inProgress);
            item.querySelector('.episode-watched-badge, .episode-resume-badge')?.remove();

            if (status.watched) {
                const badge = document.createElement('span');
                badge.className = 'episode-watched-badge';
                badge.title = 'Watched';
                badge.textContent = '\u2713 Watched';
                item.appendChild(badge);
            } else if (inProgress) {
                const badge = document.createElement('span');
                badge.className = 'episode-resume-badge';
                badge.textContent = `Continue \u00b7 ${this.formatResumeTime(status.progress)}`;
                item.appendChild(badge);
            }
        });
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

    async playEpisodeFromList(episodeEl) {
        const episodeId = episodeEl.dataset.episodeId;
        const seasonNum = episodeEl.dataset.season;
        const episodeNum = episodeEl.dataset.episode;
        const container = episodeEl.dataset.container || 'mp4';
        const episodeStatus = this.episodeWatchStatus.get(String(episodeId));

        try {
            const result = await API.proxy.xtream.getStreamUrl(this.content.sourceId, episodeId, 'series', container);

            if (result?.url) {
                const episodeTitle = episodeEl.querySelector('.watch-episode-title')?.textContent || `Episode ${episodeNum}`;

                this.play({
                    type: 'series',
                    id: episodeId,
                    title: this.content.title,
                    subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                    poster: this.content.poster,
                    description: this.content.description,
                    year: this.content.year,
                    rating: this.content.rating,
                    sourceId: this.content.sourceId,
                    seriesId: this.content.seriesId,
                    seriesInfo: this.seriesInfo,
                    currentSeason: seasonNum,
                    currentEpisode: episodeNum,
                    resumeTime: episodeStatus && !episodeStatus.watched ? episodeStatus.progress : 0
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing episode:', e);
        }
    }

    // === Next Episode ===

    getNextEpisode() {
        if (!this.seriesInfo?.episodes || !this.currentSeason || !this.currentEpisode) return null;
        const orderedEpisodes = this.getEpisodeOrder();
        const currentIndex = orderedEpisodes.findIndex(episode =>
            String(episode.seasonNum) === String(this.currentSeason) &&
            Number(episode.episode_num) === Number(this.currentEpisode)
        );
        return currentIndex >= 0 ? orderedEpisodes[currentIndex + 1] || null : null;
    }

    getEpisodeOrder() {
        const episodes = this.seriesInfo?.episodes || {};
        return Object.keys(episodes)
            .sort((a, b) => Number(a) - Number(b))
            .flatMap(seasonNum => (episodes[seasonNum] || [])
                .slice()
                .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))
                .map(episode => ({ ...episode, seasonNum })));
    }

    updateEpisodeNavigation() {
        const canNavigate = this.contentType !== 'movie' && this.currentSeason && this.currentEpisode;
        const orderedEpisodes = canNavigate ? this.getEpisodeOrder() : [];
        const currentIndex = orderedEpisodes.findIndex(episode =>
            String(episode.seasonNum) === String(this.currentSeason) &&
            Number(episode.episode_num) === Number(this.currentEpisode)
        );

        if (this.previousEpisodeBtn) this.previousEpisodeBtn.disabled = currentIndex <= 0;
        if (this.nextEpisodeBtn) this.nextEpisodeBtn.disabled = currentIndex < 0 || currentIndex >= orderedEpisodes.length - 1;
    }

    async playAdjacentEpisode(direction) {
        const orderedEpisodes = this.getEpisodeOrder();
        const currentIndex = orderedEpisodes.findIndex(episode =>
            String(episode.seasonNum) === String(this.currentSeason) &&
            Number(episode.episode_num) === Number(this.currentEpisode)
        );
        const target = orderedEpisodes[currentIndex + direction];
        if (currentIndex < 0 || !target || !this.content) return;

        this.cancelNextEpisode();
        try {
            const result = await API.proxy.xtream.getStreamUrl(
                this.content.sourceId,
                target.id,
                'series',
                target.container_extension || 'mp4'
            );
            if (!result?.url) return;

            const episodeStatus = this.episodeWatchStatus.get(String(target.id));
            this.play({
                ...this.content,
                id: target.id,
                subtitle: `S${target.seasonNum} E${target.episode_num} - ${target.title || `Episode ${target.episode_num}`}`,
                currentSeason: target.seasonNum,
                currentEpisode: target.episode_num,
                containerExtension: target.container_extension || 'mp4',
                resumeTime: episodeStatus && !episodeStatus.watched ? episodeStatus.progress : 0
            }, result.url);
        } catch (error) {
            console.error('Error changing episode:', error);
        }
    }

    showNextEpisodePanel(nextEp) {
        if (!this.nextEpisodePanel) return;

        this.nextEpisodeTitle.textContent = `S${nextEp.seasonNum} E${nextEp.episode_num} - ${nextEp.title || `Episode ${nextEp.episode_num}`}`;
        this.nextEpisodePanel.classList.remove('hidden');
        this.nextEpisodePanel.nextEpisodeData = nextEp;

        // Keep the prompt visible through the estimated credits window.
        this.nextEpisodeCountdownStarted = false;
        this.nextCountdown.textContent = '…';
    }

    startNextEpisodeCountdown() {
        if (this.nextEpisodeCountdownStarted || !this.nextEpisodePanel?.nextEpisodeData) return;
        this.nextEpisodeCountdownStarted = true;

        // Start the 10-second auto-play countdown.
        this.nextEpisodeCountdown = 10;
        this.nextCountdown.textContent = this.nextEpisodeCountdown;

        this.nextEpisodeInterval = setInterval(() => {
            this.nextEpisodeCountdown--;
            this.nextCountdown.textContent = this.nextEpisodeCountdown;

            if (this.nextEpisodeCountdown <= 0) {
                this.playNextEpisode();
            }
        }, 1000);
    }

    async playNextEpisode() {
        // Save next episode data BEFORE canceling (cancel clears the data)
        const nextEp = this.nextEpisodePanel?.nextEpisodeData;

        this.cancelNextEpisode();

        if (!nextEp) return;

        try {
            const container = nextEp.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(this.content.sourceId, nextEp.id, 'series', container);

            if (result?.url) {
                this.play({
                    type: 'series',
                    id: nextEp.id,
                    title: this.content.title,
                    subtitle: `S${nextEp.seasonNum} E${nextEp.episode_num} - ${nextEp.title || `Episode ${nextEp.episode_num}`}`,
                    poster: this.content.poster,
                    description: this.content.description,
                    year: this.content.year,
                    rating: this.content.rating,
                    sourceId: this.content.sourceId,
                    seriesId: this.content.seriesId,
                    seriesInfo: this.seriesInfo,
                    currentSeason: nextEp.seasonNum,
                    currentEpisode: nextEp.episode_num
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing next episode:', e);
        }
    }

    cancelNextEpisode() {
        clearInterval(this.nextEpisodeInterval);
        this.nextEpisodePanel?.classList.add('hidden');
        this.nextEpisodeShowing = false;
        this.nextEpisodeCountdownStarted = false;
        this.nextEpisodeDismissed = true; // Prevent re-triggering
        if (this.nextEpisodePanel) {
            this.nextEpisodePanel.nextEpisodeData = null;
        }
    }

    // === Navigation ===

    async goBack() {
        sessionStorage.removeItem(this.reloadSnapshotKey);
        const playedContent = this.content;
        if (playedContent?.type === 'series') {
            this.app.pages.series?.prepareReturnFromPlayer(playedContent);
        }
        await this.stop();
        if (playedContent?.type === 'series') {
            await this.app.pages.series?.refreshCurrentSeriesProgress(playedContent);
        }
        this.cancelNextEpisode();

        // Navigate to the page we came from (stored in returnPage)
        // We don't use history.back() because we used replaceHistory when navigating here
        this.app.navigateTo(this.returnPage || 'movies');
    }

    show() {
        // Called when page becomes visible
    }

    hide() {
        // Called when page becomes hidden
        // Don't stop playback here - allow background playback
        this.cancelNextEpisode();
    }
    // ============================================================
    // Watch History Tracking
    // ============================================================

    startHistoryTracking() {
        this.stopHistoryTracking();
        this.historyInterval = setInterval(() => this.saveProgress(), 10000); // 10s
    }

    stopHistoryTracking() {
        if (this.historyInterval) {
            clearInterval(this.historyInterval);
            this.historyInterval = null;
        }
    }

    async saveProgress(forceComplete = false, allowPaused = false) {
        const content = this.content;
        const video = this.video;
        if (!content || !video || (video.paused && !forceComplete && !allowPaused)) return;

        const duration = Math.floor(this.knownDuration || video.duration);
        const progress = forceComplete
            ? duration
            : Math.floor(video.currentTime + (this.playbackOffset || 0));

        if (isNaN(progress) || isNaN(duration) || duration <= 0) return;

        const data = {
            title: content.title || 'Unknown Title',
            subtitle: content.subtitle || (content.type === 'movie' ? 'Movie' : 'Series'),
            poster: content.poster,
            sourceId: content.sourceId,
            containerExtension: this.containerExtension,
            seriesId: content.seriesId || null,
            currentSeason: this.currentSeason || null,
            currentEpisode: this.currentEpisode || null
        };

        const saveRequest = () => window.API.request('POST', '/history', {
            id: content.id,
            type: content.type === 'movie' ? 'movie' : 'episode',
            sourceId: content.sourceId,
            parentId: content.type === 'series' ? content.seriesId : null,
            progress,
            duration,
            data
        });

        try {
            // Keep network writes in call order so an older timer save cannot
            // arrive after and overwrite the final position saved on exit.
            const previousSave = this.progressSaveQueue || Promise.resolve();
            const currentSave = previousSave.catch(() => {}).then(saveRequest);
            this.progressSaveQueue = currentSave;
            await currentSave;

            if (content.type === 'series') {
                const watched = forceComplete || progress >= duration * 0.9;
                this.updateEpisodeWatchStatus(content.id, { progress, duration, watched });
            }
        } catch (err) {
            console.warn('[History] Failed to save progress:', err);
        }
    }
}

window.WatchPage = WatchPage;
