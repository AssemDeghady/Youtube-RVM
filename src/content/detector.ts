import { StudioPageContext, StudioPageType } from '../types';

/**
 * Checks if current page is within YouTube Studio.
 */
export function isYouTubeStudio(): boolean {
  return window.location.hostname === 'studio.youtube.com';
}

/**
 * Checks whether the user is on the YouTube Studio Shorts List View.
 */
export function isShortsListView(): boolean {
  if (!isYouTubeStudio()) return false;
  const pathname = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();

  if (pathname.includes('/videos/short') || pathname.includes('/videos/shorts')) {
    return true;
  }
  if (pathname.includes('/videos') && (search.includes('short') || search.includes('d=short'))) {
    return true;
  }
  // Check active tab in DOM if on /videos
  if (pathname.includes('/videos')) {
    const activeTab = document.querySelector(
      'paper-tab.iron-selected, tp-yt-paper-tab.iron-selected, [aria-selected="true"]'
    );
    if (activeTab?.textContent?.toLowerCase().includes('short')) {
      return true;
    }
  }
  return false;
}

/**
 * Parses current YouTube Studio context from URL and DOM.
 */
export function getStudioContext(): StudioPageContext {
  const url = window.location.href;
  const pathname = window.location.pathname;

  let pageType: StudioPageType = 'unknown';
  let channelId: string | null = null;
  let videoId: string | null = null;

  // Pattern: /channel/{channelId}/...
  const channelMatch = pathname.match(/\/channel\/([a-zA-Z0-9_-]+)/);
  if (channelMatch) {
    channelId = channelMatch[1];
  }

  // Pattern: /video/{videoId}/edit
  const videoMatch = pathname.match(/\/video\/([a-zA-Z0-9_-]+)/);
  if (videoMatch) {
    videoId = videoMatch[1];
  }

  // Query parameter fallback for video
  const urlParams = new URLSearchParams(window.location.search);
  if (!videoId && urlParams.has('v')) {
    videoId = urlParams.get('v');
  }

  // Classify page type
  if (isShortsListView()) {
    pageType = 'content_shorts';
  } else if (pathname.includes('/videos/upload') || pathname.endsWith('/videos')) {
    pageType = 'content_uploads';
  } else if (pathname.includes('/video/') && pathname.includes('/edit')) {
    pageType = 'video_details';
  } else if (pathname.includes('/analytics')) {
    pageType = 'analytics';
  } else if (pathname.includes('/comments')) {
    pageType = 'comments';
  } else if (pathname.includes('/subtitles')) {
    pageType = 'subtitles';
  } else if (pathname.includes('/editing')) {
    pageType = 'customization';
  } else if (channelId && (pathname.endsWith(`/channel/${channelId}`) || pathname.endsWith(`/channel/${channelId}/`))) {
    pageType = 'dashboard';
  } else if (isYouTubeStudio()) {
    pageType = 'other_studio';
  }

  return {
    url,
    pathname,
    pageType,
    channelId,
    videoId,
    title: document.title || 'YouTube Studio',
    timestamp: new Date().toISOString()
  };
}

/**
 * Nicely formatted console logging for YouTube Studio context.
 */
export function logStudioDiagnostics(context: StudioPageContext, eventReason = 'Initial Load'): void {
  const prefix = '%c[ShortLinker POC]';
  const style = 'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 4px;';
  
  console.groupCollapsed(
    `${prefix} YouTube Studio Event: ${eventReason} (${context.pageType})`,
    style
  );
  console.log('%cPage Context Details:', 'font-weight: bold; color: #64748b;', {
    PageType: context.pageType,
    VideoId: context.videoId || '(none)',
    ChannelId: context.channelId || '(none)',
    Pathname: context.pathname,
    URL: context.url,
    Title: context.title,
    Timestamp: context.timestamp
  });
  console.log(
    '%cRelated Video Inspection Target:%c ' +
      (context.pageType === 'video_details' && context.videoId
        ? `Ready to inspect video editor for video ID: ${context.videoId}`
        : 'Navigate to Video Details editor (/video/<id>/edit) to inspect Related Video inputs.'),
    'font-weight: bold; color: #22c55e;',
    'color: #94a3b8;'
  );
  console.groupEnd();
}
