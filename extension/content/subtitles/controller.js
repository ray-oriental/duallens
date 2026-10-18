import { isYouTube } from './track.js';
import { YouTubeSubtitles } from './youtube.js';
import { HTML5Subtitles } from './html5.js';
export { YouTubeSubtitles };
export function VideoSubtitles(options) {
  return isYouTube(location.hostname) ? new YouTubeSubtitles(options) : new HTML5Subtitles(options);
}
