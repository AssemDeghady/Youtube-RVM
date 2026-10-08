export type RequestClassification =
  | 'UNKNOWN'
  | 'STUDIO_NAVIGATION'
  | 'VIDEO_LIST'
  | 'VIDEO_SEARCH'
  | 'VIDEO_METADATA'
  | 'VIDEO_UPDATE'
  | 'RELATED_VIDEO_CANDIDATE'
  | 'RELATED_VIDEO_MUTATION'
  | 'SAVE'
  | 'ERROR'
  | 'OTHER';

/**
 * Classifies an observed network request by its endpoint, method, and safe structural fields.
 */
export function classifyNetworkRequest(
  method: string,
  pathname: string,
  status: number | null,
  structuralAnalysis?: any
): { classification: RequestClassification; description: string } {
  const upperMethod = (method || '').toUpperCase();
  const lowerPath = (pathname || '').toLowerCase();

  // 1. HTTP Errors
  if (status !== null && status >= 400) {
    return {
      classification: 'ERROR',
      description: `HTTP ${status} on ${pathname}`
    };
  }

  // 2. Related Video Mutation
  if (
    upperMethod === 'POST' &&
    lowerPath.includes('/youtubei/v1/video_manager/metadata_update')
  ) {
    const props = structuralAnalysis?.properties;
    const hasLinkage = Boolean(props?.videoLinkageShortsAttribution);
    if (hasLinkage) {
      return {
        classification: 'RELATED_VIDEO_MUTATION',
        description: 'Confirmed Shorts Related Video metadata update mutation'
      };
    }
    return {
      classification: 'RELATED_VIDEO_CANDIDATE',
      description: 'Studio video_manager metadata_update candidate'
    };
  }

  // 3. Creator Video List / Catalog
  if (
    lowerPath.includes('/creator/list_creator_videos') ||
    lowerPath.includes('/creator/get_creator_videos')
  ) {
    return {
      classification: 'VIDEO_LIST',
      description: 'Studio creator video catalog list endpoint'
    };
  }

  // 4. Video Search in Creator Studio
  if (
    lowerPath.includes('/creator/search') ||
    lowerPath.includes('/video_picker') ||
    lowerPath.includes('/search')
  ) {
    return {
      classification: 'VIDEO_SEARCH',
      description: 'Video search / picker query endpoint'
    };
  }

  // 5. Video Details / Metadata fetch
  if (
    lowerPath.includes('/video_metadata') ||
    lowerPath.includes('/get_video') ||
    lowerPath.includes('/video_details')
  ) {
    return {
      classification: 'VIDEO_METADATA',
      description: 'Video metadata retrieval endpoint'
    };
  }

  // 6. Generic Video Update / Save
  if (
    upperMethod === 'POST' &&
    (lowerPath.includes('metadata_update') || lowerPath.includes('edit_video') || lowerPath.includes('/save'))
  ) {
    return {
      classification: 'SAVE',
      description: 'General video metadata save endpoint'
    };
  }

  // 7. Studio SPA Navigation / Page State
  if (
    lowerPath.includes('/navigation') ||
    lowerPath.includes('/browse') ||
    lowerPath.includes('/guide') ||
    lowerPath.includes('/page_data')
  ) {
    return {
      classification: 'STUDIO_NAVIGATION',
      description: 'Studio internal SPA navigation / page data'
    };
  }

  // 8. Other YouTubei / Google APIs
  if (lowerPath.includes('/youtubei/') || lowerPath.includes('/creator/')) {
    return {
      classification: 'OTHER',
      description: `Other Studio internal endpoint: ${pathname}`
    };
  }

  return {
    classification: 'UNKNOWN',
    description: `Unclassified network request: [${upperMethod}] ${pathname}`
  };
}
