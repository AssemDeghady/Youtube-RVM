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

export interface RelatedVideoMutationMeta {
  sourceVideoId: string;
  targetVideoId: string;
  timestamp: string;
  httpStatus: number | null;
  pathname: string;
  flowType?: string;
  hasAttestation: boolean;
}

export interface ReplayResult {
  success: boolean;
  httpStatus: number;
  statusText: string;
  durationMs: number;
  sourceVideoId: string;
  targetVideoId: string;
  timestamp: string;
  sanitizedResponseSnippet: string;
  attestationRejected?: boolean;
}

import type { ClassifiedError } from '../common/error-classifier';

export type MutationItemStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'not_attempted';

export interface MutationItemProgress {
  sourceShortId: string;
  targetVideoId: string;
  status: MutationItemStatus;
  httpStatus?: number;
  statusText?: string;
  durationMs?: number;
  error?: string;
  classifiedError?: ClassifiedError;
  attestationRejected?: boolean;
}

export interface MutationJobSummary {
  jobId: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  notAttempted: number;
  isCancelled: boolean;
  failedItemIds: string[];
  items: MutationItemProgress[];
}

export interface ImmutableJobSnapshot {
  jobId: string;
  targetVideoId: string;
  targetVideoTitle?: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  notAttempted: number;
  isCancelled: boolean;
  items: readonly MutationItemProgress[];
  failedItemIds: readonly string[];
  finishedAt: string;
}

export interface MutationExecutePayload {
  jobId: string;
  sourceShortIds: string[];
  targetVideoId: string;
  delayMs?: number;
}

export interface TargetVideo {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration?: string;
  publishedAt?: string;
  videoType?: string; // 'upload' | 'short' | 'live' | etc.
}

export const BRIDGE_EVENTS = {
  CAPTURE: 'shortlinker-network-capture',
  CONTROL: 'shortlinker-control-command',
  MUTATION_DETECTED: 'shortlinker-mutation-detected',
  REPLAY_REQUEST: 'shortlinker-replay-request',
  REPLAY_RESPONSE: 'shortlinker-replay-response',
  EXECUTE_MUTATION: 'shortlinker-execute-mutation',
  MUTATION_PROGRESS: 'shortlinker-mutation-progress',
  MUTATION_COMPLETE: 'shortlinker-mutation-complete',
  CANCEL_MUTATION: 'shortlinker-cancel-mutation',
  TEMPLATE_STATUS_REQUEST: 'shortlinker-template-status-request',
  TEMPLATE_STATUS_RESPONSE: 'shortlinker-template-status-response',
  CATALOG_REQUEST: 'shortlinker-catalog-request',
  CATALOG_RESPONSE: 'shortlinker-catalog-response',
  REFRESH_CATALOG: 'shortlinker-refresh-catalog',
  RETRY_FAILED: 'shortlinker-retry-failed'
} as const;
