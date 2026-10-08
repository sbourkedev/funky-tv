/**
 * Movies Page Controller
 * Handles VOD movie browsing and playback
 */

class MoviesPage {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('movies-grid');
        this.detailsPanel = document.getElementById('movie-details');
        this.currentMovie = null;
        this.movieContinueButton = document.querySelector('.movie-continue-btn');
        this.movieOverviewStorageKey = 'funky-player-movie-overview';
        this.pendingMovieOverview = null;
        this.sourceSelect = document.getElementById('movies-source-select');
        this.categorySelect = document.getElementById('movies-category-select');
        this.searchInput = document.getElementById('movies-search');

        this.movies = [];
        this.categories = [];
        this.sources = [];
        this.currentBatch = 0;
        this.batchSize = 24;
        this.filteredMovies = [];
        this.isLoading = false;
        this.observer = null;
        this.favoriteIds = new Set(); // Track favorite movie IDs
        this.movieWatchStatus = new Map();

        this.init();
    }

    init() {
        // Source change handler
        this.sourceSelect?.addEventListener('change', async () => {
            await this.loadCategories();
            await this.loadMovies();
        });

        // Category change handler
        this.categorySelect?.addEventListener('change', () => {
            this.loadMovies();
        });

        // Search with debounce
        let searchTimeout;
        this.searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.filterAndRender(), 300);
        });

        document.querySelector('.movie-back-btn')?.addEventListener('click', () => this.hideMovieDetails());
        document.querySelector('.movie-play-btn')?.addEventListener('click', () => {
            if (this.currentMovie) this.playMovie(this.currentMovie, false);
        });
        this.movieContinueButton?.addEventListener('click', () => {
            if (this.currentMovie) this.playMovie(this.currentMovie, true);
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
        if (!this.currentMovie) {
            try {
                const saved = sessionStorage.getItem(this.movieOverviewStorageKey);
                if (saved) this.pendingMovieOverview = JSON.parse(saved);
            } catch (err) {
                console.warn('[Movies] Could not restore saved movie overview:', err);
                sessionStorage.removeItem(this.movieOverviewStorageKey);
            }
        }
        // Load sources if not loaded
        if (this.sources.length === 0) {
            await this.loadSources();
        }

        // Load favorites
        await this.loadFavorites();
        await this.loadMovieProgress();

        // Load movies if empty
        if (this.movies.length === 0) {
            await this.loadCategories();
            await this.loadMovies();
        } else {
            this.filterAndRender();
        }
        if (this.currentMovie) this.renderMovieDetails(this.currentMovie);
        if (this.pendingMovieOverview) {
            const savedMovie = this.pendingMovieOverview;
            this.pendingMovieOverview = null;
            const movie = this.movies.find(item =>
                String(item.sourceId) === String(savedMovie.sourceId)
                && String(item.stream_id) === String(savedMovie.stream_id)
            ) || savedMovie;
            await this.showMovieDetails(movie);
        }

    }

    async resetFiltersAndRefresh() {
        this.hideMovieDetails();
        // Replace the previous results before any network-backed setup calls so
        // they do not flash while the refreshed list is being prepared.
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        if (this.searchInput) this.searchInput.value = '';
        if (this.sourceSelect) this.sourceSelect.value = '';
        if (this.categorySelect) this.categorySelect.value = '';
        if (this.sources.length === 0) await this.loadSources();
        await this.loadFavorites();
        await this.loadCategories();
        await this.loadMovies();
    }

    hide() {
        // Page is hidden
    }

    async loadFavorites() {
        try {
            const favs = await API.favorites.getAll(null, 'movie');
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
            this.hiddenCategoryIds = new Set(); // Track hidden categories
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
                        if (h.item_type === 'vod_category') {
                            this.hiddenCategoryIds.add(`${source.id}:${h.item_id}`);
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load hidden items from source ${source.id}`);
                }
            }

            for (const source of sourcesToLoad) {
                try {
                    const cats = await API.proxy.xtream.vodCategories(source.id);
                    if (cats && Array.isArray(cats)) {
                        cats.forEach(c => {
                            // Skip hidden categories
                            if (!this.hiddenCategoryIds.has(`${source.id}:${c.category_id}`)) {
                                this.categories.push({ ...c, sourceId: source.id });
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load categories from source ${source.id}:`, err.message);
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

    async loadMovies() {
        this.isLoading = true;
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            this.movies = [];

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
                            continue; // Skip this source if category is from different source
                        }
                    }

                    const movies = await API.proxy.xtream.vodStreams(source.id, catId);
                    console.log(`[Movies] Source ${source.id}, Category ${catId || 'ALL'}: Got ${movies?.length || 0} movies`);
                    if (movies && Array.isArray(movies)) {
                        movies.forEach(m => {
                            // Skip movies from hidden categories
                            if (this.hiddenCategoryIds && this.hiddenCategoryIds.has(`${source.id}:${m.category_id}`)) {
                                return;
                            }
                            this.movies.push({
                                ...m,
                                sourceId: source.id,
                                id: `${source.id}:${m.stream_id}`
                            });
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load movies from source ${source.id}:`, err.message);
                }
            }

            console.log(`[Movies] Total loaded: ${this.movies.length} movies`);
            await this.loadMovieProgress();
            this.filterAndRender();
        } catch (err) {
            console.error('Error loading movies:', err);
            this.container.innerHTML = '<div class="empty-state"><p>Error loading movies</p></div>';
        } finally {
            this.isLoading = false;
        }
    }

    async loadMovieProgress() {
        this.movieWatchStatus = new Map();
        const sourceIds = this.sourceSelect?.value
            ? [Number(this.sourceSelect.value)]
            : this.sources.map(source => source.id);

        const rowsBySource = await Promise.all(sourceIds.map(async sourceId => {
            try {
                return [sourceId, await API.history.getMovieProgress(sourceId)];
            } catch (err) {
                console.warn(`[Movies] Could not load watch status for source ${sourceId}:`, err.message);
                return [sourceId, []];
            }
        }));

        rowsBySource.forEach(([sourceId, rows]) => {
            rows.forEach(row => this.movieWatchStatus.set(`${sourceId}:${row.item_id}`, row));
        });

        this.container?.querySelectorAll('.movie-card').forEach(card => {
            const status = this.movieWatchStatus.get(`${card.dataset.sourceId}:${card.dataset.movieId}`);
            const badge = card.querySelector('.movie-watched-badge');
            if (status?.watched) {
                card.classList.add('watched');
                badge?.classList.remove('hidden');
            } else {
                card.classList.remove('watched');
                badge?.classList.add('hidden');
            }
        });
    }

    filterAndRender() {
        const searchTerm = this.searchInput?.value?.toLowerCase() || '';

        this.filteredMovies = this.movies.filter(m => {
            if (searchTerm && !m.name?.toLowerCase().includes(searchTerm)) {
                return false;
            }
            return true;
        });

        console.log(`[Movies] Displaying ${this.filteredMovies.length} of ${this.movies.length} movies`);

        this.currentBatch = 0;
        this.container.innerHTML = '';

        if (this.filteredMovies.length === 0) {
            this.container.innerHTML = '<div class="empty-state"><p>No movies found</p></div>';
            return;
        }

        const favoritesShelf = this.createFavoritesShelf();
        if (favoritesShelf) this.container.appendChild(favoritesShelf);

        // Create loader element
        const loader = document.createElement('div');
        loader.className = 'movies-loader';
        loader.innerHTML = '<div class="loading-spinner"></div>';
        this.container.appendChild(loader);

        // Render initial batches (more to fill viewport)
        for (let i = 0; i < 5; i++) {
            this.renderNextBatch();
        }

        // Start observing loader
        this.observer.observe(loader);
    }

    renderNextBatch() {
        const start = this.currentBatch * this.batchSize;
        const end = start + this.batchSize;
        const batch = this.filteredMovies.slice(start, end);

        console.log(`[Movies] Rendering batch ${this.currentBatch}: ${batch.length} cards (${start}-${end})`);

        if (batch.length === 0) {
            const loader = this.container.querySelector('.movies-loader');
            if (loader) loader.style.display = 'none';
            return;
        }

        const fragment = document.createDocumentFragment();

        batch.forEach(movie => {
            fragment.appendChild(this.createMovieCard(movie));
        });

        // Insert before loader
        const loader = this.container.querySelector('.movies-loader');
        if (loader) {
            this.container.insertBefore(fragment, loader);
        } else {
            this.container.appendChild(fragment);
        }

        this.currentBatch++;

        // Hide loader if done
        if (end >= this.filteredMovies.length && loader) {
            loader.style.display = 'none';
        }
    }

    createMovieCard(movie) {
        const card = document.createElement('div');
        const watchStatus = this.movieWatchStatus.get(`${movie.sourceId}:${movie.stream_id}`);
        const isWatched = Boolean(watchStatus?.watched);
        const isFav = this.favoriteIds.has(`${movie.sourceId}:${movie.stream_id}`);
        card.className = `movie-card ${isWatched ? 'watched' : ''}`;
        card.dataset.movieId = movie.stream_id;
        card.dataset.sourceId = movie.sourceId;

        const poster = movie.stream_icon || movie.cover || '/img/placeholder.png';
        const year = movie.year || movie.releaseDate?.substring(0, 4) || '';
        const rating = movie.rating ? `${Icons.star} ${movie.rating}` : '';
        card.innerHTML = `
            <div class="movie-poster">
                <img src="${poster}" alt="${movie.name}"
                     onerror="this.onerror=null;this.src='/img/placeholder.png'" loading="lazy">
                <div class="movie-play-overlay">
                    <span class="play-icon">${Icons.play}</span>
                </div>
                <span class="movie-watched-badge ${isWatched ? '' : 'hidden'}">&#10003; Watched</span>
                <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                    <span class="fav-icon">${isFav ? Icons.favorite : Icons.favoriteOutline}</span>
                </button>
            </div>
            <div class="movie-info">
                <div class="movie-title">${movie.name}</div>
                <div class="movie-meta">
                    ${year ? `<span>${year}</span>` : ''}
                    ${rating ? `<span>${rating}</span>` : ''}
                </div>
                <button class="movie-overview-button" type="button">Overview</button>
            </div>
        `;
        card.addEventListener('click', (event) => {
            if (event.target.closest('.favorite-btn')) {
                this.toggleFavorite(movie, event.target.closest('.favorite-btn'));
                event.stopPropagation();
            } else if (event.target.closest('.movie-overview-button')) {
                event.stopPropagation();
                this.showMovieDetails(movie);
            } else {
                this.playMovie(movie);
            }
        });
        return card;
    }

    createFavoritesShelf() {
        const favorites = this.filteredMovies.filter(movie =>
            this.favoriteIds.has(`${movie.sourceId}:${movie.stream_id}`)
        );
        if (favorites.length === 0) return null;

        const shelf = document.createElement('section');
        shelf.className = 'favorites-shelf';
        shelf.innerHTML = '<h3 class="favorites-shelf-title">Favorite Movies</h3>';
        const cards = document.createElement('div');
        cards.className = 'favorites-shelf-cards';
        favorites.forEach(movie => cards.appendChild(this.createMovieCard(movie)));
        shelf.appendChild(cards);
        return shelf;
    }

    saveMovieOverview(movie) {
        try {
            sessionStorage.setItem(this.movieOverviewStorageKey, JSON.stringify({
                sourceId: movie.sourceId,
                stream_id: movie.stream_id,
                name: movie.name || 'Movie',
                stream_icon: movie.stream_icon || movie.cover || movie.movie_image || '',
                plot: movie.plot || movie.description || '',
                year: movie.year || movie.releaseDate || '',
                rating: movie.rating || '',
                genre: movie.genre || '',
                duration: movie.duration || '',
                container_extension: movie.container_extension || 'mp4',
                category_id: movie.category_id
            }));
        } catch (err) {
            console.warn('[Movies] Could not save selected movie overview:', err);
        }
    }

    async showMovieDetails(movie) {
        if (!movie) return;

        this.currentMovie = movie;
        this.container.classList.add('hidden');
        this.detailsPanel.classList.remove('hidden');
        this.renderMovieDetails(movie, true);
        this.saveMovieOverview(movie);

        try {
            const details = await API.proxy.xtream.vodInfo(movie.sourceId, movie.stream_id);
            const isStillSelected = this.currentMovie
                && String(this.currentMovie.sourceId) === String(movie.sourceId)
                && String(this.currentMovie.stream_id) === String(movie.stream_id);
            if (!isStillSelected || !details) return;

            const detailedMovie = {
                ...movie,
                ...(details.movie_data || {}),
                ...(details.info || {}),
                sourceId: movie.sourceId,
                stream_id: movie.stream_id
            };
            this.currentMovie = detailedMovie;
            this.renderMovieDetails(detailedMovie);
            this.saveMovieOverview(detailedMovie);
        } catch (err) {
            console.warn('[Movies] Could not load movie synopsis:', err);
            const isStillSelected = this.currentMovie
                && String(this.currentMovie.sourceId) === String(movie.sourceId)
                && String(this.currentMovie.stream_id) === String(movie.stream_id);
            if (isStillSelected) this.renderMovieDetails(this.currentMovie);
        }
    }

    renderMovieDetails(movie, isLoadingSynopsis = false) {
        const poster = this.detailsPanel.querySelector('#movie-overview-poster');
        poster.src = movie.stream_icon || movie.cover || movie.movie_image || movie.cover_big || '/img/placeholder.png';
        poster.alt = `${movie.name || 'Movie'} poster`;
        this.detailsPanel.querySelector('#movie-overview-title').textContent = movie.name || 'Movie';

        const watchStatus = this.movieWatchStatus.get(`${movie.sourceId}:${movie.stream_id}`);
        const canContinue = !watchStatus?.watched && Number(watchStatus?.progress) > 0;
        this.movieContinueButton?.classList.toggle('hidden', !canContinue);

        const synopsis = [movie.plot, movie.description, movie.info?.plot, movie.movie_data?.plot]
            .find(value => typeof value === 'string' && value.trim());
        this.detailsPanel.querySelector('#movie-overview-plot').textContent = synopsis || (isLoadingSynopsis ? 'Loading synopsis...' : 'No synopsis is available for this movie.');

        const year = movie.year || movie.released?.substring(0, 4) || movie.releaseDate?.substring(0, 4);
        const rating = movie.rating ? `Rating: ${movie.rating}` : '';
        const genre = movie.genre || '';
        const duration = movie.duration || '';
        this.detailsPanel.querySelector('#movie-overview-meta').textContent =
            [year, rating, genre, duration].filter(Boolean).join(' | ');
    }

    hideMovieDetails() {
        this.detailsPanel.classList.add('hidden');
        this.container.classList.remove('hidden');
        this.currentMovie = null;
        sessionStorage.removeItem(this.movieOverviewStorageKey);
    }

    async playMovie(movie, resume = true) {
        try {
            // Get stream URL for movie using the actual container extension from API
            // Xtream API returns container_extension (e.g., 'mp4', 'mkv', 'avi')
            const container = movie.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(movie.sourceId, movie.stream_id, 'movie', container);

            if (result && result.url) {
                // Play in dedicated Watch page
                if (this.app.pages.watch) {
                    this.app.pages.watch.play({
                        type: 'movie',
                        id: movie.stream_id,
                        title: movie.name,
                        poster: movie.stream_icon || movie.cover,
                        description: movie.plot || '',
                        year: movie.year || movie.releaseDate?.substring(0, 4),
                        rating: movie.rating,
                        sourceId: movie.sourceId,
                        categoryId: movie.category_id,
                        containerExtension: container,
                        resumeTime: resume && !this.movieWatchStatus.get(`${movie.sourceId}:${movie.stream_id}`)?.watched
                            ? (Number(this.movieWatchStatus.get(`${movie.sourceId}:${movie.stream_id}`)?.progress) || 0)
                            : 0
                    }, result.url);
                }
            }
        } catch (err) {
            console.error('Error playing movie:', err);
        }
    }
    async toggleFavorite(movie, btn) {
        const favKey = `${movie.sourceId}:${movie.stream_id}`;
        const isFav = this.favoriteIds.has(favKey);
        const iconSpan = btn.querySelector('.fav-icon');

        try {
            // Optimistic update
            if (isFav) {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                btn.title = 'Add to Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
                await API.favorites.remove(movie.sourceId, movie.stream_id, 'movie');
            } else {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                btn.title = 'Remove from Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
                await API.favorites.add(movie.sourceId, movie.stream_id, 'movie');
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

window.MoviesPage = MoviesPage;
