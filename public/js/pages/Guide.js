/**
 * Guide Page Controller
 */

class GuidePage {
    constructor(app) {
        this.app = app;
    }

    async init() {
        // EPG guide will lazy load when shown
    }

    async show({ resetFilters = false } = {}) {
        // Ensure channel data is loaded before rendering EPG
        // This fixes a race condition where navigating directly to the Guide page
        // before visiting Live TV would result in an empty EPG.
        const channelList = this.app.channelList;
        if (!channelList.channels || channelList.channels.length === 0) {
            await channelList.loadSources();
            await channelList.loadChannels();
        }

        if (resetFilters) {
            await this.resetFiltersAndRefresh();
            return;
        }

        // Only load EPG data if not already loaded
        if (!this.app.epgGuide.programmes || this.app.epgGuide.programmes.length === 0) {
            await this.app.epgGuide.loadEpg();
        } else {
            // Just re-render with existing data (updates time position)
            this.app.epgGuide.render();
        }
    }

    async resetFiltersAndRefresh() {
        const guide = this.app.epgGuide;
        if (guide.searchInput) guide.searchInput.value = '';
        guide.selectedGroup = '';
        guide.timeOffset = 0;
        if (guide.groupSelect) guide.groupSelect.value = '';
        await guide.loadEpg(true);
    }

    hide() {
        // Page is hidden
    }
}

window.GuidePage = GuidePage;
