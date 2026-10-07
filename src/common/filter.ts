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

export interface RelatedVideoMutationDetection {
  isRelatedVideoMutation: boolean;
  sourceVideoId?: string;
  targetVideoId?: string;
  flowType?: string;
  hasAttestation?: boolean;
}

/**
 * Specifically identifies whether a request is a YouTube Shorts Related Video mutation.
 * Matches: POST /youtubei/v1/video_manager/metadata_update
 * requiring: videoLinkageShortsAttribution.targetExternalVideoId
 */
export function isRelatedVideoMutation(
  urlStr: string,
  method: string,
  rawBody: any
): RelatedVideoMutationDetection {
  if (method.toUpperCase() !== 'POST') {
    return { isRelatedVideoMutation: false };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr, window.location.origin);
  } catch {
    return { isRelatedVideoMutation: false };
  }

  if (!parsedUrl.pathname.includes('/youtubei/v1/video_manager/metadata_update')) {
    return { isRelatedVideoMutation: false };
  }

  let parsedBody: any = rawBody;
  if (typeof rawBody === 'string') {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return { isRelatedVideoMutation: false };
    }
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return { isRelatedVideoMutation: false };
  }

  // Check for videoLinkageShortsAttribution.targetExternalVideoId
  const linkage = parsedBody.videoLinkageShortsAttribution;
  if (!linkage || typeof linkage !== 'object') {
    return { isRelatedVideoMutation: false };
  }

  const targetExternal = linkage.targetExternalVideoId;
  let targetVideoId = '';
  if (Array.isArray(targetExternal) && targetExternal.length > 0) {
    targetVideoId = String(targetExternal[0]);
  } else if (typeof targetExternal === 'string') {
    targetVideoId = targetExternal;
  }

  if (!targetVideoId) {
    return { isRelatedVideoMutation: false };
  }

  const sourceVideoId = parsedBody.encryptedVideoId || '';
  const flowType = parsedBody.flowType || '';
  const hasAttestation = Boolean(parsedBody.attestationResponseData);

  return {
    isRelatedVideoMutation: true,
    sourceVideoId,
    targetVideoId,
    flowType,
    hasAttestation
  };
}
