import { RequestClassification } from '../common/network-classifier';

export type DiagnosticLevel = 0 | 1 | 2 | 3 | 4;

export type EventCategory = 'ACTION' | 'NETWORK' | 'DOM' | 'STATE' | 'ERROR' | 'INFO';

export interface DiagnosticTimelineEvent {
  id: string;
  timestamp: string;
  relativeTimeMs: number;
  category: EventCategory;
  summary: string;
  details?: any;
}

export interface DiagnosticNetworkEvent {
  id: string;
  timestamp: string;
  relativeTimeMs: number;
  method: string;
  origin: string;
  path: string;
  queryKeys: string[];
  sanitizedQueryParams: Record<string, string>;
  status: number | null;
  durationMs: number | null;
  initiator: string;
  classification: RequestClassification;
  description: string;
  requestStructure?: any;
  responseStructure?: any;
}

export interface DiagnosticDomSnapshot {
  timestamp: string;
  relativeTimeMs: number;
  elementName: string;
  found: boolean;
  strategy?: string;
  selectorUsed?: string;
  tag?: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  visible?: boolean;
  enabled?: boolean;
  shadowPath?: string[];
  textSnippet?: string;
}

export interface DiagnosticStateChange {
  timestamp: string;
  relativeTimeMs: number;
  field: string;
  oldValue: any;
  newValue: any;
  reason?: string;
}

export interface DiagnosticSummary {
  totalRequests: number;
  mutationRequests: number;
  saveRequests: number;
  studioErrors: number;
  navigationCount: number;
  avgDurationPerItemMs?: number;
  finalResult: string;
}

export interface DiagnosticSession {
  sessionId: string;
  sessionType: 'our_extension' | 'tubebuddy_observation' | 'manual';
  startTime: string;
  startTimestamp: number;
  endTime?: string;
  endTimestamp?: number;
  extensionVersion: string;
  studioUrl: string;
  targetVideoId?: string;
  shortIds: string[];
  timeline: DiagnosticTimelineEvent[];
  networkEvents: DiagnosticNetworkEvent[];
  domEvents: DiagnosticDomSnapshot[];
  stateTransitions: DiagnosticStateChange[];
  shadowTreeSnapshot?: string;
  summary?: DiagnosticSummary;
  securityNotice: string;
}

export interface ComparisonReport {
  comparedAt: string;
  tubeBuddySessionId?: string;
  ourSessionId?: string;
  tubeBuddyRequestCount: number;
  ourRequestCount: number;
  requestsUniqueToTubeBuddy: string[];
  requestsUniqueToOurExtension: string[];
  commonEndpoints: string[];
  mutationEndpointObserved: {
    tubeBuddy: boolean;
    ourExtension: boolean;
    endpointPath?: string;
  };
  navigationBehavior: {
    tubeBuddy: string;
    ourExtension: string;
  };
  structuralDifferences: string[];
  timingSummary: {
    tubeBuddyAvgMs?: number;
    ourAvgMs?: number;
  };
  conclusion: string;
}
