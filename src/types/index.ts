export type StudioPageType =
  | 'dashboard'
  | 'content_shorts'
  | 'content_uploads'
  | 'video_details'
  | 'analytics'
  | 'comments'
  | 'subtitles'
  | 'customization'
  | 'other_studio'
  | 'unknown';

export interface StudioPageContext {
  url: string;
  pathname: string;
  pageType: StudioPageType;
  channelId: string | null;
  videoId: string | null;
  title: string;
  timestamp: string;
}

export type NavigationChangeCallback = (context: StudioPageContext) => void;

export type BodyRepresentationType =
  | 'json'
  | 'text'
  | 'url-encoded'
  | 'form-data'
  | 'empty'
  | 'binary/unsupported';

export interface CapturedRequest {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  hostname: string;
  pathname: string;
  contentType: string;
  safeHeaders: Record<string, string>;
  sanitizedBody: any;
  bodyType: BodyRepresentationType;
  status: number | null;
  statusText: string | null;
  durationMs: number | null;
  source: 'fetch' | 'xhr';
}

export const BRIDGE_EVENTS = {
  CAPTURE: 'shortlinker-network-capture',
  CONTROL: 'shortlinker-control-command',
  SYNC: 'shortlinker-control-sync'
} as const;
