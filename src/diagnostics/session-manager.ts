/**
 * Diagnostic Session Manager
 * 
 * Central manager for recording, classifying, sanitizing, and exporting
 * safe runtime diagnostics for YouTube Studio Related Video workflows.
 * 
 * STRICT SECURITY: Zero credentials, tokens, or cookies are ever stored or exported.
 */

import {
  DiagnosticSession,
  DiagnosticTimelineEvent,
  DiagnosticNetworkEvent,
  DiagnosticLevel,
  EventCategory,
  DiagnosticStateChange,
  ComparisonReport
} from './types';
import { sanitizeUrl, analyzeJsonStructure } from '../common/sanitizer';
import { classifyNetworkRequest } from '../common/network-classifier';
import { createDomSnapshots, inspectStudioShadowTree } from '../content/shadow-inspector';

export class DiagnosticSessionManager {
  private static instance: DiagnosticSessionManager | null = null;
  private currentSession: DiagnosticSession | null = null;
  private savedSessions: Map<string, DiagnosticSession> = new Map();
  private debugLevel: DiagnosticLevel = 0; // Default: 0 (OFF)
  private listeners: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): DiagnosticSessionManager {
    if (!DiagnosticSessionManager.instance) {
      DiagnosticSessionManager.instance = new DiagnosticSessionManager();
    }
    return DiagnosticSessionManager.instance;
  }

  public getDebugLevel(): DiagnosticLevel {
    return this.debugLevel;
  }

  public setDebugLevel(level: DiagnosticLevel): void {
    this.debugLevel = level;
    this.notify();
  }

  public isRecording(): boolean {
    return this.currentSession !== null && this.debugLevel > 0;
  }

  public getCurrentSession(): DiagnosticSession | null {
    return this.currentSession;
  }

  public getSavedSessions(): DiagnosticSession[] {
    return Array.from(this.savedSessions.values());
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error('[ShortLinker Diagnostics] Error in listener:', err);
      }
    }
  }

  /**
   * Starts a new diagnostic session with a unique session ID.
   */
  public startSession(
    sessionType: 'our_extension' | 'tubebuddy_observation' | 'manual' = 'our_extension',
    targetVideoId?: string,
    shortIds: string[] = []
  ): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const randStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const sessionId = `RVM-${dateStr}-${timeStr}-${randStr}`;

    this.currentSession = {
      sessionId,
      sessionType,
      startTime: now.toLocaleTimeString(),
      startTimestamp: performance.now(),
      extensionVersion: '1.0.0-debug',
      studioUrl: window.location.href,
      targetVideoId,
      shortIds: [...shortIds],
      timeline: [],
      networkEvents: [],
      domEvents: [],
      stateTransitions: [],
      securityNotice:
        'All credentials, cookies, authorization values, OAuth tokens, attestation data, and other sensitive authentication material were redacted.'
    };

    if (this.debugLevel === 0) {
      this.debugLevel = 3; // Automatically set to level 3 when user starts a session
    }

    this.addTimelineEvent(
      'INFO',
      `Diagnostic session started (${sessionType})`,
      { sessionId, targetVideoId, shortCount: shortIds.length }
    );

    this.notify();
    return sessionId;
  }

  /**
   * Stops the active session and creates a summary.
   */
  public stopSession(finalResult = 'Session Completed'): DiagnosticSession | null {
    if (!this.currentSession) return null;

    const now = new Date();
    this.currentSession.endTime = now.toLocaleTimeString();
    this.currentSession.endTimestamp = performance.now();

    // Capture final Shadow DOM tree structure if at level 2+
    if (this.debugLevel >= 2) {
      try {
        this.currentSession.shadowTreeSnapshot = inspectStudioShadowTree(document.body, 0, 4);
      } catch {}
    }

    // Compile summary
    const totalRequests = this.currentSession.networkEvents.length;
    const mutationRequests = this.currentSession.networkEvents.filter(
      (n) => n.classification === 'RELATED_VIDEO_MUTATION'
    ).length;
    const saveRequests = this.currentSession.networkEvents.filter(
      (n) => n.classification === 'SAVE'
    ).length;
    const studioErrors = this.currentSession.networkEvents.filter(
      (n) => n.classification === 'ERROR'
    ).length;
    const navEvents = this.currentSession.timeline.filter(
      (t) => t.category === 'ACTION' && t.summary.toLowerCase().includes('navigat')
    ).length;

    this.currentSession.summary = {
      totalRequests,
      mutationRequests,
      saveRequests,
      studioErrors,
      navigationCount: navEvents,
      finalResult
    };

    this.addTimelineEvent('INFO', `Diagnostic session stopped. Result: ${finalResult}`, {
      totalRequests,
      mutationRequests,
      finalResult
    });

    const session = this.currentSession;
    this.savedSessions.set(session.sessionId, session);
    this.currentSession = null;
    this.notify();
    return session;
  }

  /**
   * Records a timeline event.
   */
  public addTimelineEvent(category: EventCategory, summary: string, details?: any): void {
    if (!this.currentSession) return;

    const relativeTimeMs = Math.round(performance.now() - this.currentSession.startTimestamp);
    const event: DiagnosticTimelineEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      relativeTimeMs,
      category,
      summary,
      details
    };

    this.currentSession.timeline.push(event);
    this.notify();
  }

  /**
   * Records an observed network request, sanitizing URLs and bodies.
   */
  public recordNetworkRequest(
    method: string,
    rawUrl: string,
    status: number | null,
    durationMs: number | null,
    initiator = 'page',
    rawBody?: any,
    rawResponse?: any
  ): void {
    if (!this.currentSession || this.debugLevel < 3) return;

    const relativeTimeMs = Math.round(performance.now() - this.currentSession.startTimestamp);
    const { origin, pathname, queryKeys, sanitizedQueryParams } = sanitizeUrl(rawUrl);

    let requestStructure: any = undefined;
    let responseStructure: any = undefined;

    if (this.debugLevel >= 4) {
      if (rawBody) {
        requestStructure = analyzeJsonStructure(rawBody);
      }
      if (rawResponse) {
        responseStructure = analyzeJsonStructure(rawResponse);
      }
    }

    const { classification, description } = classifyNetworkRequest(
      method,
      pathname,
      status,
      requestStructure
    );

    const netEvent: DiagnosticNetworkEvent = {
      id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      relativeTimeMs,
      method: method.toUpperCase(),
      origin,
      path: pathname,
      queryKeys,
      sanitizedQueryParams,
      status,
      durationMs,
      initiator,
      classification,
      description,
      requestStructure,
      responseStructure
    };

    this.currentSession.networkEvents.push(netEvent);

    // Add entry to timeline for visibility
    this.addTimelineEvent(
      'NETWORK',
      `[${netEvent.method}] ${pathname} (${status ?? 'pending'}) - ${classification}`,
      { durationMs, queryKeys }
    );
  }

  /**
   * Captures a DOM snapshot of all required elements.
   */
  public recordDomState(label = 'DOM Snapshot'): void {
    if (!this.currentSession || this.debugLevel < 2) return;

    const relativeTimeMs = Math.round(performance.now() - this.currentSession.startTimestamp);
    const snapshots = createDomSnapshots(relativeTimeMs);
    this.currentSession.domEvents.push(...snapshots);

    const foundCount = snapshots.filter((s) => s.found).length;
    this.addTimelineEvent('DOM', `${label}: ${foundCount}/${snapshots.length} elements detected`, {
      detected: snapshots.filter((s) => s.found).map((s) => `${s.elementName} (${s.strategy})`)
    });
  }

  /**
   * Records a Studio state change.
   */
  public recordStateChange(field: string, oldValue: any, newValue: any, reason?: string): void {
    if (!this.currentSession) return;

    const relativeTimeMs = Math.round(performance.now() - this.currentSession.startTimestamp);
    const change: DiagnosticStateChange = {
      timestamp: new Date().toLocaleTimeString(),
      relativeTimeMs,
      field,
      oldValue,
      newValue,
      reason
    };

    this.currentSession.stateTransitions.push(change);
    this.addTimelineEvent('STATE', `State change: ${field} = ${JSON.stringify(newValue)}`, {
      oldValue,
      reason
    });
  }

  /**
   * Generates a comparison report between a TubeBuddy session and a ShortLinker session.
   */
  public generateComparisonReport(
    tubeBuddySessionId?: string,
    ourSessionId?: string
  ): ComparisonReport {
    const sessions = Array.from(this.savedSessions.values());
    const tbSession = tubeBuddySessionId
      ? this.savedSessions.get(tubeBuddySessionId)
      : sessions.find((s) => s.sessionType === 'tubebuddy_observation');

    const ourSession = ourSessionId
      ? this.savedSessions.get(ourSessionId)
      : sessions.find((s) => s.sessionType === 'our_extension');

    const tbRequests = tbSession?.networkEvents.map((n) => `${n.method} ${n.path}`) || [];
    const ourRequests = ourSession?.networkEvents.map((n) => `${n.method} ${n.path}`) || [];

    const tbSet = new Set(tbRequests);
    const ourSet = new Set(ourRequests);

    const commonEndpoints = tbRequests.filter((r) => ourSet.has(r));
    const uniqueToTubeBuddy = tbRequests.filter((r) => !ourSet.has(r));
    const uniqueToOur = ourRequests.filter((r) => !tbSet.has(r));

    const tbHasMutation = Boolean(
      tbSession?.networkEvents.some((n) => n.classification === 'RELATED_VIDEO_MUTATION')
    );
    const ourHasMutation = Boolean(
      ourSession?.networkEvents.some((n) => n.classification === 'RELATED_VIDEO_MUTATION')
    );

    return {
      comparedAt: new Date().toLocaleString(),
      tubeBuddySessionId: tbSession?.sessionId,
      ourSessionId: ourSession?.sessionId,
      tubeBuddyRequestCount: tbRequests.length,
      ourRequestCount: ourRequests.length,
      requestsUniqueToTubeBuddy: Array.from(new Set(uniqueToTubeBuddy)),
      requestsUniqueToOurExtension: Array.from(new Set(uniqueToOur)),
      commonEndpoints: Array.from(new Set(commonEndpoints)),
      mutationEndpointObserved: {
        tubeBuddy: tbHasMutation,
        ourExtension: ourHasMutation,
        endpointPath: '/youtubei/v1/video_manager/metadata_update'
      },
      navigationBehavior: {
        tubeBuddy: tbSession?.timeline.some((t) => t.summary.includes('Navigat'))
          ? 'Navigates per video'
          : 'In-page action',
        ourExtension: ourSession?.timeline.some((t) => t.summary.includes('Navigat'))
          ? 'Navigates per video'
          : 'In-page action'
      },
      structuralDifferences: [
        `TubeBuddy generated ${tbRequests.length} requests; Our extension generated ${ourRequests.length} requests.`,
        tbHasMutation
          ? 'TubeBuddy successfully triggered Related Video mutation.'
          : 'TubeBuddy mutation endpoint not captured or differed.'
      ],
      timingSummary: {},
      conclusion:
        tbSession && ourSession
          ? 'Comparison generated successfully from real captured sessions.'
          : 'Missing one or both sessions for direct comparison. Run both observation sessions first.'
    };
  }

  /**
   * Generates a clean, sanitized Markdown diagnostic report for ChatGPT.
   */
  public generateMarkdownReport(sessionId?: string): string {
    const session = sessionId
      ? this.savedSessions.get(sessionId) || this.currentSession
      : this.currentSession || Array.from(this.savedSessions.values()).pop();

    if (!session) {
      return '# No Diagnostic Session Available\n\nPlease run an operation with diagnostics enabled first.';
    }

    const lines: string[] = [];
    lines.push(`# RVM Diagnostic Report: ${session.sessionId}`);
    lines.push(`**Session Type:** ${session.sessionType}`);
    lines.push(`**Time:** ${session.startTime} → ${session.endTime || 'In progress'}`);
    lines.push(`**Target Video:** \`${session.targetVideoId || 'None'}\``);
    lines.push(`**Shorts Count:** ${session.shortIds.length}`);
    lines.push(`**Extension Version:** ${session.extensionVersion}`);
    lines.push(`**Studio URL:** \`${session.studioUrl}\``);
    lines.push('');
    lines.push('> 🔒 **SECURITY STATEMENT:**');
    lines.push(
      '> All credentials, cookies, authorization values, OAuth tokens, attestation data, and other sensitive authentication material were redacted.'
    );
    lines.push('');

    // Summary
    if (session.summary) {
      lines.push('## Executive Summary');
      lines.push(`- **Result:** ${session.summary.finalResult}`);
      lines.push(`- **Total Observed Requests:** ${session.summary.totalRequests}`);
      lines.push(`- **Mutation Requests:** ${session.summary.mutationRequests}`);
      lines.push(`- **Save Endpoints:** ${session.summary.saveRequests}`);
      lines.push(`- **Errors Detected:** ${session.summary.studioErrors}`);
      lines.push('');
    }

    // Network Requests Table
    lines.push('## Observed Network Requests');
    if (session.networkEvents.length === 0) {
      lines.push('*No network requests observed.*');
    } else {
      lines.push('| Relative Time | Method | Path | Status | Duration | Classification |');
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
      for (const req of session.networkEvents) {
        lines.push(
          `| +${req.relativeTimeMs}ms | \`${req.method}\` | \`${req.path}\` | ${req.status ?? '-'} | ${req.durationMs ? `${req.durationMs}ms` : '-'} | **${req.classification}** |`
        );
      }
    }
    lines.push('');

    // Operation Timeline
    lines.push('## Operation Timeline');
    for (const evt of session.timeline) {
      lines.push(`- **[+${evt.relativeTimeMs}ms]** \`${evt.category}\`: ${evt.summary}`);
    }
    lines.push('');

    // Shadow DOM Tree
    if (session.shadowTreeSnapshot) {
      lines.push('## Studio Shadow DOM Hierarchy');
      lines.push('```text');
      lines.push(session.shadowTreeSnapshot);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Exports the session as a downloadable JSON file.
   */
  public exportSessionJson(sessionId?: string): void {
    const session = sessionId
      ? this.savedSessions.get(sessionId) || this.currentSession
      : this.currentSession || Array.from(this.savedSessions.values()).pop();

    if (!session) {
      alert('No diagnostic session found to export.');
      return;
    }

    const jsonStr = JSON.stringify(session, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const filename = `rvm-diagnostics-${dateStr}-${timeStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
