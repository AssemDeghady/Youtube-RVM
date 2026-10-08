import type { ClassifiedError } from '../common/error-classifier';

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

export type AutomationState =
  | 'idle'
  | 'navigating_to_editor'
  | 'waiting_for_editor'
  | 'opening_related_video'
  | 'waiting_for_picker'
  | 'searching_target'
  | 'selecting_target'
  | 'saving'
  | 'waiting_for_save'
  | 'save_succeeded'
  | 'save_failed'
  | 'returning_to_list'
  | 'cancelled'
  | 'timeout';

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
  status: number;
  statusText: string;
  durationMs: number;
  source: 'fetch' | 'xhr';
}

export interface RelatedVideoMutationMeta {
  sourceVideoId: string;
  targetVideoId: string;
  timestamp: string;
  httpStatus?: number;
  pathname?: string;
  flowType?: string;
  hasAttestation?: boolean;
}

export interface TemplateStatus {
  hasTemplate: boolean;
  sourceVideoId?: string;
  targetVideoId?: string;
  timestamp?: string;
}

export interface AutomationJob {
  jobId: string;
  sourceShortIds: string[];
  targetVideoId: string;
  targetTitle?: string;
  createdAt: number;
}

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
  stepDescription?: string;
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
  targetTitle?: string;
  delayMs?: number;
}

export interface TargetVideo {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration?: string;
  publishedAt?: string;
  videoType?: string;
}

export const BRIDGE_EVENTS = {
  CONTROL: 'shortlinker-control-command',
  CAPTURE: 'shortlinker-capture-event',
  MUTATION_DETECTED: 'shortlinker-mutation-detected',
  TEMPLATE_STATUS_REQUEST: 'shortlinker-template-status-request',
  TEMPLATE_STATUS_RESPONSE: 'shortlinker-template-status-response',
  CLEAR_TEMPLATE: 'shortlinker-clear-template',
  EXECUTE_MUTATION: 'shortlinker-execute-mutation',
  CANCEL_MUTATION: 'shortlinker-cancel-mutation',
  MUTATION_PROGRESS: 'shortlinker-mutation-progress',
  MUTATION_COMPLETE: 'shortlinker-mutation-complete',
  CATALOG_REQUEST: 'shortlinker-catalog-request',
  CATALOG_RESPONSE: 'shortlinker-catalog-response',
  REFRESH_CATALOG: 'shortlinker-refresh-catalog',
  DIAGNOSTIC_NETWORK: 'shortlinker-diagnostic-network',
  DIAGNOSTIC_CONTROL: 'shortlinker-diagnostic-control'
} as const;
