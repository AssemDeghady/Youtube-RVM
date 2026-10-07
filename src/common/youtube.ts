/**
 * Utility functions for YouTube video URL normalization, ID validation,
 * and Related Video mutation payload construction.
 */

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const BLACKLISTED_DOM_STRINGS = new Set([
  'table-heade',
  'table-header',
  'video-title',
  'checkbox-lit',
  'header-cell',
  'section-head',
  'entity-row-c'
]);

/**
 * Validates that a string is a genuine 11-char YouTube video ID
 * and not an accidental slice of a DOM element ID.
 */
export function isValidYouTubeVideoId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!YOUTUBE_ID_REGEX.test(trimmed)) return false;
  if (BLACKLISTED_DOM_STRINGS.has(trimmed.toLowerCase())) return false;
  return true;
}

export interface VideoIdParseResult {
  isValid: boolean;
  videoId?: string;
  error?: string;
}

/**
 * Normalizes any standard YouTube URL or raw 11-char ID into a valid YouTube video ID.
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - Raw 11-character video ID
 */
export function normalizeYouTubeVideoId(input: string): VideoIdParseResult {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'Input is empty' };
  }

  const trimmed = input.trim();

  // 1. Raw 11-character video ID
  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return { isValid: true, videoId: trimmed };
  }

  // 2. URL parsing
  let parsedUrl: URL;
  try {
    // Add protocol if user typed youtube.com or youtu.be without https://
    const urlWithProtocol = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    parsedUrl = new URL(urlWithProtocol);
  } catch {
    return { isValid: false, error: 'Invalid URL format or video ID' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname;

  // youtu.be/VIDEO_ID
  if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
    const candidateId = pathname.replace(/^\/+/, '').split('/')[0]?.split('?')[0];
    if (candidateId && YOUTUBE_ID_REGEX.test(candidateId)) {
      return { isValid: true, videoId: candidateId };
    }
  }

  // youtube.com / m.youtube.com
  if (hostname.includes('youtube.com')) {
    // /watch?v=VIDEO_ID
    if (pathname === '/watch' || pathname.startsWith('/watch/')) {
      const vParam = parsedUrl.searchParams.get('v');
      if (vParam && YOUTUBE_ID_REGEX.test(vParam)) {
        return { isValid: true, videoId: vParam };
      }
    }

    // /shorts/VIDEO_ID
    if (pathname.startsWith('/shorts/')) {
      const parts = pathname.split('/shorts/')[1]?.split('/')[0]?.split('?')[0];
      if (parts && YOUTUBE_ID_REGEX.test(parts)) {
        return { isValid: true, videoId: parts };
      }
    }

    // /embed/VIDEO_ID
    if (pathname.startsWith('/embed/')) {
      const parts = pathname.split('/embed/')[1]?.split('/')[0]?.split('?')[0];
      if (parts && YOUTUBE_ID_REGEX.test(parts)) {
        return { isValid: true, videoId: parts };
      }
    }
  }

  return {
    isValid: false,
    error: 'Could not extract valid 11-character YouTube video ID'
  };
}

/**
 * Constructs the metadata_update payload for linking a Related Video to a Short.
 * Preserves the captured base template's client context and attestation data.
 */
export function buildRelatedVideoPayload(
  baseTemplatePayload: any,
  sourceShortId: string,
  targetRelatedVideoId: string
): any {
  if (!baseTemplatePayload || typeof baseTemplatePayload !== 'object') {
    throw new Error('Base mutation template payload is required');
  }

  // Deep clone base template to avoid mutating cached state
  const cloned = JSON.parse(JSON.stringify(baseTemplatePayload));

  // Set target Short to be updated
  cloned.encryptedVideoId = sourceShortId;

  // Set flow type to edit
  cloned.flowType = 'MDE_FLOW_TYPE_EDIT';

  // Set target Related Video linkage
  cloned.videoLinkageShortsAttribution = {
    targetExternalVideoId: [targetRelatedVideoId]
  };

  return cloned;
}
