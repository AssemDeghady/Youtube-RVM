const RELEVANT_KEYWORDS = [
  'youtubei',
  'metadata',
  'video',
  'edit',
  'save',
  'mutation'
];

const IGNORED_ENDPOINTS = [
  'log_event',
  'stats/playback',
  'playlog',
  'heartbeat',
  'ptracking',
  'feedback',
  'batch_logging',
  'qoe',
  'ad_break',
  'notifications/get_unseen_count',
  'client_streamz'
];

/**
 * Checks whether an HTTP request is potentially relevant to YouTube Studio video metadata mutations.
 */
export function isCandidateRequest(urlStr: string, method = 'POST'): { isCandidate: boolean; reason: string } {
  const upperMethod = method.toUpperCase();

  // YouTube Studio data mutations are almost exclusively POST requests
  if (upperMethod !== 'POST' && upperMethod !== 'PUT' && upperMethod !== 'PATCH') {
    return { isCandidate: false, reason: 'Non-mutating HTTP method' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr, window.location.origin);
  } catch {
    return { isCandidate: false, reason: 'Invalid URL format' };
  }

  const fullPath = (parsedUrl.pathname + parsedUrl.search).toLowerCase();

  // Exclude high-frequency telemetry / logging noise
  for (const noise of IGNORED_ENDPOINTS) {
    if (fullPath.includes(noise)) {
      return { isCandidate: false, reason: `Ignored telemetry pattern: ${noise}` };
    }
  }

  // Must match relevant YouTubei / Studio mutation keywords
  const matchedKeywords = RELEVANT_KEYWORDS.filter((keyword) => fullPath.includes(keyword));

  if (matchedKeywords.length >= 1) {
    return {
      isCandidate: true,
      reason: `Matched keywords: [${matchedKeywords.join(', ')}] on ${parsedUrl.pathname}`
    };
  }

  return { isCandidate: false, reason: 'No metadata/mutation keywords found' };
}
