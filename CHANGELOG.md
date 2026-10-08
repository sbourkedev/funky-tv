# Changelog

Notable changes made during the current development session.

## Unreleased — 2026-10-08

### Playback and transcoding

- Added Fast, Balanced, and Stable stream startup profiles to control FFmpeg and FFprobe analysis limits; Balanced is the default.
- Updated the player timeline to show media duration and playback position instead of treating the growing transcode buffer as the full timeline.
- Added seeking from anywhere on the timeline, including points beyond the currently buffered segment. The timeline position and purple progress fill update immediately while seeking.
- Added a hover timestamp showing the point that will be selected on the timeline.
- Restored playback position when resuming an in-progress episode, and improved playback restoration after a page reload.
- Added a 1440p transcoding quality option.
- Adjusted live stream transcoding behavior for sources that reject FFmpeg's default HLS requests; MPEG-TS output works with the affected source.
- Use accurate FFmpeg seeking when resuming a stream-copy transcode, avoiding keyframe-based jumps past the saved position.

### Watch history

- Added watched and in-progress indicators for movies and episodes, with controls to mark episodes and seasons watched or unwatched.
- Save the latest playback position when leaving the player, including when playback is paused, and serialize progress writes to prevent stale saves overwriting newer positions.
- Refresh the episode progress shown on the series overview when returning from playback.
- Prevent the stopped player from overwriting saved progress when the series page is later refreshed.
- Added continue-watching actions for in-progress episodes and a per-episode control to set series progress, marking earlier episodes and seasons watched as appropriate.
- Added controls to remove items from watch history and reset a series' progress.
- Consolidated continue-watching entries so a series appears once instead of once per episode.

### Series and library browsing

- Added favorites sections to the series and movie lists and removed the favorites control from the top navigation bar.
- Added watched status to season headers and automatically collapsed fully watched seasons.
- Added a series overview action to series cards and made series playback resume from the latest in-progress episode.
- Added a series overview playback button that continues the latest in-progress episode or starts from the first episode when no progress exists.
- Series playback resumes five seconds before the saved position to provide a little context.
- Series overviews now remain selected after a refresh and when returning from playback.
- Improved episode status badge placement so resume and watched labels stay clear of the action buttons.
- Series overviews now show the rating, total season and episode counts, and the full show runtime when episode durations are available.
- Added a hoverable movie overview action with a synopsis and a play option.
- Movie overviews now load detailed synopsis data and remain open after a page refresh.
- In-progress movie overviews offer separate Continue Watching and Play Movie actions; Play Movie starts from the beginning.
- Top navigation links for Live TV, TV Guide, Movies, and Series now clear filters and refresh their page.
- Avoid duplicate page loads when switching categories from the top navigation, and clear stale movie or series cards as soon as a refresh begins.
