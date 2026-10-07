import type { TargetVideo } from '../types/index.ts';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Formats a duration in seconds into MM:SS or HH:MM:SS.
 */
export function formatDurationSeconds(val: number | string | undefined | null): string | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const totalSeconds = typeof val === 'string' ? parseInt(val, 10) : val;
  if (isNaN(totalSeconds) || totalSeconds < 0) return undefined;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Extracts title string from various YouTubei title formats.
 */
function extractTitle(titleObj: any): string {
  if (!titleObj) return 'Untitled Video';
  if (typeof titleObj === 'string') return titleObj;
  if (Array.isArray(titleObj.runs) && titleObj.runs.length > 0) {
    return titleObj.runs.map((r: any) => r.text || '').join('');
  }
  if (titleObj.simpleText && typeof titleObj.simpleText === 'string') {
    return titleObj.simpleText;
  }
  return 'Untitled Video';
}

/**
 * Extracts thumbnail URL from YouTubei thumbnail formats,
 * falling back to YouTube's standard media CDN.
 */
function extractThumbnailUrl(thumbObj: any, videoId: string): string {
  if (thumbObj && Array.isArray(thumbObj.thumbnails) && thumbObj.thumbnails.length > 0) {
    // Pick the last (usually best quality) or first
    const last = thumbObj.thumbnails[thumbObj.thumbnails.length - 1];
    if (last && last.url) return last.url;
  }
  if (typeof thumbObj === 'string' && thumbObj.startsWith('http')) {
    return thumbObj;
  }
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Extracts video type or content category.
 */
function extractVideoType(item: any): string | undefined {
  if (item.videoType && typeof item.videoType === 'string') {
    return item.videoType.replace(/^VIDEO_TYPE_/i, '').toLowerCase();
  }
  if (item.videoContentType && typeof item.videoContentType === 'string') {
    return item.videoContentType.toLowerCase();
  }
  if (item.isShort || item.lengthSeconds && Number(item.lengthSeconds) <= 60 && item.aspectRatio === 'ASPECT_RATIO_VERTICAL') {
    return 'short';
  }
  return 'video';
}

/**
 * Safely parses YouTube Studio creator video list responses into a TargetVideo catalog.
 * Handles both list_creator_videos and get_creator_videos structures.
 */
export function parseCreatorVideosResponse(responseJson: any): TargetVideo[] {
  if (!responseJson || typeof responseJson !== 'object') {
    return [];
  }

  const results: Map<string, TargetVideo> = new Map();

  // Helper to process candidate video object
  function processCandidate(item: any) {
    if (!item || typeof item !== 'object') return;

    // Check video ID candidates
    const rawId = item.videoId || item.encryptedVideoId || item.externalVideoId;
    if (typeof rawId === 'string' && YOUTUBE_ID_REGEX.test(rawId.trim())) {
      const id = rawId.trim();
      const title = extractTitle(item.title);
      const thumbnailUrl = extractThumbnailUrl(item.thumbnail || item.thumbnails, id);

      // Duration: lengthSeconds, formattedDuration, or overlay
      let duration = formatDurationSeconds(item.lengthSeconds || item.durationSeconds);
      if (!duration && item.formattedDuration && typeof item.formattedDuration === 'string') {
        duration = item.formattedDuration;
      }

      // Published At
      let publishedAt: string | undefined;
      if (item.publishedTimeText?.simpleText) {
        publishedAt = item.publishedTimeText.simpleText;
      } else if (item.scheduledPublishTime) {
        publishedAt = 'Scheduled';
      }

      const videoType = extractVideoType(item);

      if (!results.has(id)) {
        results.set(id, {
          id,
          title,
          thumbnailUrl,
          duration,
          publishedAt,
          videoType
        });
      }
    }
  }

  // 1. Direct array checks
  const directArrays = [
    responseJson.videos,
    responseJson.items,
    responseJson.videoList,
    responseJson.contents,
    responseJson.entities
  ];

  for (const arr of directArrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        processCandidate(item);
        if (item.videoRenderer) processCandidate(item.videoRenderer);
        if (item.gridVideoRenderer) processCandidate(item.gridVideoRenderer);
        if (item.creatorVideoRenderer) processCandidate(item.creatorVideoRenderer);
      }
    }
  }

  // 2. Recursive search if direct arrays did not find items
  if (results.size === 0) {
    function traverse(node: any, depth = 0) {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        for (const child of node) traverse(child, depth + 1);
      } else if (typeof node === 'object') {
        if (node.videoId || node.encryptedVideoId || node.externalVideoId) {
          processCandidate(node);
        }
        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object') {
            traverse(node[key], depth + 1);
          }
        }
      }
    }
    traverse(responseJson);
  }

  return Array.from(results.values());
}
