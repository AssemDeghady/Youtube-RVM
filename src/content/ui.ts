/**
 * ShortLinker — YouTube Shorts Related Video Manager
 * Production UI Controller (Shadow DOM Component)
 * 
 * Works entirely within the YouTube Studio Shorts listing view.
 * Zero credentials stored, displayed, or exported.
 */

import {
  StudioPageContext,
  MutationItemProgress,
  MutationJobSummary,
  ImmutableJobSnapshot,
  TargetVideo,
  BRIDGE_EVENTS
} from '../types';
import { normalizeYouTubeVideoId } from '../common/youtube';
import { VideoCatalogStore } from '../common/video-catalog';
import { isShortsListView } from './detector';
import { DiagnosticSessionManager } from '../diagnostics/session-manager';
import { EventCategory } from '../diagnostics/types';

export class ShortLinkerUI {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private currentContext: StudioPageContext | null = null;
  private isMinimized = false;

  // Onboarding & Diagnostics Toggle
  private isOnboardingDismissed = false;
  private showDiagnostics = false;
  private isConfirmingBulk = false;

  // Video Catalog & Target Selection
  private catalogStore: VideoCatalogStore = new VideoCatalogStore();
  private selectedTargetVideo: TargetVideo | null = null;
  private normalizedTargetId: string | null = null;
  private isPickerOpen = false;
  private searchQuery = '';
  private isManualFallbackOpen = false;
  private manualInputVal = '';
  private manualInputError: string | null = null;

  // Shorts List View State
  private selectedShortIds: string[] = [];

  // Volatile Session Mutation Template Status
  private hasTemplate = false;
  private templateMeta: {
    sourceVideoId?: string;
    targetVideoId?: string;
    timestamp?: string;
  } | null = null;

  // Execution state
  private bulkJobState: 'idle' | 'running' | 'cancelled' | 'done' = 'idle';
  private bulkItemsProgress: Map<string, MutationItemProgress> = new Map();
  private bulkSummary: MutationJobSummary | null = null;
  private lastJobSnapshot: ImmutableJobSnapshot | null = null;
  private currentJobId: string | null = null;

  // Real-time execution status
  private currentActiveShortId: string | null = null;
  private isStopping = false;

  // Diagnostics Manager (OFF by default)
  private diagManager = DiagnosticSessionManager.getInstance();
  private diagFilter: 'ALL' | EventCategory = 'ALL';
  private isTubeBuddyObserving = false;
  private comparisonSummaryText: string | null = null;

  public mount(initialContext: StudioPageContext): void {
    if (this.hostElement) return;

    this.currentContext = initialContext;
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'shortlinker-root';
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    document.body.appendChild(this.hostElement);

    // Request creator videos catalog from MAIN world
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.CATALOG_REQUEST));

    // Request template calibration status from MAIN world
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.TEMPLATE_STATUS_REQUEST));

    // Extract any existing DOM video rows as immediate fallback
    this.catalogStore.extractFromDom();

    // Listen for catalog updates from MAIN world
    document.addEventListener(BRIDGE_EVENTS.CATALOG_RESPONSE, ((event: CustomEvent<{ videos: TargetVideo[] }>) => {
      if (event.detail && Array.isArray(event.detail.videos)) {
        this.catalogStore.addVideos(event.detail.videos);
        this.render();
      }
    }) as EventListener);

    // Listen for template calibration status responses
    document.addEventListener(BRIDGE_EVENTS.TEMPLATE_STATUS_RESPONSE, ((event: CustomEvent<any>) => {
      if (event.detail) {
        this.hasTemplate = Boolean(event.detail.hasTemplate);
        this.templateMeta = event.detail;
        this.render();
      }
    }) as EventListener);

    // Listen for new template captures from Studio manual saves
    document.addEventListener(BRIDGE_EVENTS.MUTATION_DETECTED, ((event: CustomEvent<any>) => {
      if (event.detail) {
        this.hasTemplate = true;
        this.templateMeta = event.detail;
        this.render();
      }
    }) as EventListener);

    // Listen for listing-page mutation execution progress
    document.addEventListener(BRIDGE_EVENTS.MUTATION_PROGRESS, ((event: CustomEvent<MutationItemProgress>) => {
      const item = event.detail;
      if (!item) return;

      this.currentActiveShortId = item.sourceShortId;

      if (this.bulkJobState === 'running') {
        this.bulkItemsProgress.set(item.sourceShortId, item);
      }

      if (this.diagManager.isRecording()) {
        this.diagManager.addTimelineEvent(
          item.status === 'failed' ? 'ERROR' : 'ACTION',
          `Short [${item.sourceShortId}] -> ${item.status}`,
          item
        );
      }
      this.render();
    }) as EventListener);

    // Listen for listing-page mutation job completion
    document.addEventListener(BRIDGE_EVENTS.MUTATION_COMPLETE, ((event: CustomEvent<MutationJobSummary>) => {
      const summary = event.detail;
      if (!summary) return;

      this.bulkSummary = summary;
      this.bulkJobState = summary.isCancelled ? 'cancelled' : 'done';
      this.isStopping = false;

      this.lastJobSnapshot = Object.freeze({
        jobId: summary.jobId,
        targetVideoId: this.normalizedTargetId || '',
        targetVideoTitle: this.selectedTargetVideo?.title,
        total: summary.total,
        completed: summary.completed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        notAttempted: summary.notAttempted,
        isCancelled: summary.isCancelled,
        items: Object.freeze([...summary.items]),
        failedItemIds: Object.freeze([...summary.failedItemIds]),
        finishedAt: new Date().toLocaleTimeString()
      });

      if (this.diagManager.isRecording()) {
        this.diagManager.addTimelineEvent(
          'ACTION',
          `Job [${summary.jobId}] complete: ${summary.succeeded} OK, ${summary.failed} failed, ${summary.notAttempted} unattempted`
        );
        this.diagManager.stopSession(summary.isCancelled ? 'Cancelled' : summary.failed === 0 ? 'All Succeeded' : 'Finished with Failures');
      }

      this.render();
    }) as EventListener);

    // Listen for safe diagnostic network events from MAIN world
    document.addEventListener(BRIDGE_EVENTS.DIAGNOSTIC_NETWORK, ((event: CustomEvent<any>) => {
      if (event.detail && this.diagManager.isRecording()) {
        this.diagManager.recordNetworkRequest(
          event.detail.method,
          event.detail.url,
          event.detail.status,
          event.detail.durationMs,
          event.detail.initiator || 'page',
          event.detail.requestStructure,
          event.detail.responseStructure
        );
        this.render();
      }
    }) as EventListener);

    // Subscribe to diagnostics updates
    this.diagManager.subscribe(() => {
      this.render();
    });

    this.render();
  }

  public updateContext(context: StudioPageContext): void {
    this.currentContext = context;
    this.catalogStore.extractFromDom();
    this.render();
  }

  public updateSelection(selectedIds: string[]): void {
    this.selectedShortIds = selectedIds;
    if (this.bulkJobState === 'done' || this.bulkJobState === 'cancelled') {
      this.bulkJobState = 'idle';
      this.bulkSummary = null;
      this.bulkItemsProgress.clear();
    }
    this.render();
  }

  private selectTargetVideo(video: TargetVideo): void {
    this.selectedTargetVideo = video;
    this.normalizedTargetId = video.id;
    this.manualInputVal = '';
    this.manualInputError = null;
    this.isPickerOpen = false;
    this.render();
  }

  private clearTargetVideo(): void {
    this.selectedTargetVideo = null;
    this.normalizedTargetId = null;
    this.manualInputVal = '';
    this.manualInputError = null;
    this.render();
  }

  private handleManualInput(val: string): void {
    this.manualInputVal = val;
    if (!val.trim()) {
      this.clearTargetVideo();
      return;
    }
    const res = normalizeYouTubeVideoId(val);
    if (res.isValid && res.videoId) {
      this.normalizedTargetId = res.videoId;
      this.manualInputError = null;
      this.selectedTargetVideo = {
        id: res.videoId,
        title: `Video (${res.videoId})`,
        thumbnailUrl: `https://i.ytimg.com/vi/${res.videoId}/mqdefault.jpg`
      };
    } else {
      this.normalizedTargetId = null;
      this.selectedTargetVideo = null;
      this.manualInputError = res.error || 'Please enter a valid YouTube video link or 11-character ID';
    }
    this.render();
  }

  private requestCatalogRefresh(): void {
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REFRESH_CATALOG));
  }

  private executeBulkAssignment(idsToRun?: string[]): void {
    const ids = idsToRun || this.selectedShortIds;
    if (!this.normalizedTargetId || ids.length === 0 || this.bulkJobState === 'running') {
      return;
    }

    this.isConfirmingBulk = false;
    this.bulkJobState = 'running';
    this.bulkSummary = null;
    this.bulkItemsProgress.clear();
    this.isStopping = false;
    this.currentJobId = `bulk_${Date.now()}`;

    // Initialize in-memory queue state
    for (const id of ids) {
      this.bulkItemsProgress.set(id, {
        sourceShortId: id,
        targetVideoId: this.normalizedTargetId,
        status: 'queued'
      });
    }

    if (this.diagManager.getDebugLevel() > 0 && !this.diagManager.isRecording()) {
      this.diagManager.startSession('our_extension', this.normalizedTargetId, ids);
    }

    this.render();

    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.EXECUTE_MUTATION, {
        detail: {
          jobId: this.currentJobId,
          sourceShortIds: [...ids],
          targetVideoId: this.normalizedTargetId,
          targetTitle: this.selectedTargetVideo?.title,
          delayMs: 800
        }
      })
    );
  }

  private retryFailedItems(): void {
    if (!this.lastJobSnapshot || this.lastJobSnapshot.failedItemIds.length === 0) return;
    const failedIds = [...this.lastJobSnapshot.failedItemIds];
    this.executeBulkAssignment(failedIds);
  }

  private copyFailedIds(buttonEl: HTMLButtonElement): void {
    if (!this.lastJobSnapshot || this.lastJobSnapshot.failedItemIds.length === 0) return;
    const text = this.lastJobSnapshot.failedItemIds.join('\n');
    this.copyToClipboard(text, buttonEl);
  }

  private cancelBulkJob(): void {
    if (this.bulkJobState !== 'running') return;
    this.isStopping = true;
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.CANCEL_MUTATION));
    this.render();
  }

  private toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    this.render();
  }

  private copyToClipboard(text: string, buttonEl?: HTMLElement | null): void {
    navigator.clipboard.writeText(text).then(
      () => {
        if (buttonEl) {
          const orig = buttonEl.textContent;
          buttonEl.textContent = 'Copied!';
          setTimeout(() => {
            buttonEl.textContent = orig;
          }, 1500);
        }
      },
      () => {}
    );
  }

  private toggleDiagnosticsMode(): void {
    const current = this.diagManager.getDebugLevel();
    const newLevel = current === 0 ? 3 : 0;
    this.diagManager.setDebugLevel(newLevel);

    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.DIAGNOSTIC_CONTROL, {
        detail: { active: newLevel > 0 }
      })
    );

    if (newLevel > 0 && !this.diagManager.isRecording()) {
      this.diagManager.startSession('manual', this.normalizedTargetId || undefined, this.selectedShortIds);
    }
    this.render();
  }

  private toggleTubeBuddyObservation(): void {
    if (this.isTubeBuddyObserving) {
      this.isTubeBuddyObserving = false;
      this.diagManager.stopSession('Observation Finished');
    } else {
      this.isTubeBuddyObserving = true;
      if (this.diagManager.getDebugLevel() === 0) {
        this.diagManager.setDebugLevel(3);
        document.dispatchEvent(
          new CustomEvent(BRIDGE_EVENTS.DIAGNOSTIC_CONTROL, {
            detail: { active: true }
          })
        );
      }
      this.diagManager.startSession('tubebuddy_observation', undefined, this.selectedShortIds);
    }
    this.render();
  }

  private render(): void {
    if (!this.shadowRoot || !this.currentContext) return;

    if (this.isMinimized) {
      this.shadowRoot.innerHTML = `
        <style>
          .min-badge {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #09090b;
            color: #f4f4f5;
            border: 1px solid #27272a;
            padding: 8px 14px;
            border-radius: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            cursor: pointer;
            z-index: 999999;
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
          }
          .pulse-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
            display: inline-block;
          }
        </style>
        <div class="min-badge" id="restore-btn">
          <span class="pulse-dot"></span>
          <span>ShortLinker</span>
        </div>
      `;
      this.shadowRoot.getElementById('restore-btn')?.addEventListener('click', () => {
        this.toggleMinimize();
      });
      return;
    }

    const onShortsList = isShortsListView();
    const selectedCount = this.selectedShortIds.length;
    const isJobActive = this.bulkJobState === 'running';
    const canApply = this.hasTemplate && selectedCount > 0 && Boolean(this.normalizedTargetId) && !isJobActive;

    const css = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .panel-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 380px;
        max-height: 86vh;
        background: #09090b;
        color: #f4f4f5;
        border: 1px solid #27272a;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.65);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .header-row {
        background: #18181b;
        padding: 12px 14px;
        border-bottom: 1px solid #27272a;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .title-group {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .main-title {
        font-size: 13px;
        font-weight: 700;
        color: #fafafa;
        letter-spacing: -0.01em;
      }
      .sub-title {
        font-size: 11px;
        color: #a1a1aa;
      }
      .minimize-btn {
        background: transparent;
        border: none;
        color: #a1a1aa;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 4px 6px;
        border-radius: 4px;
      }
      .minimize-btn:hover {
        background: #27272a;
        color: #ffffff;
      }
      .scroll-body {
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: calc(86vh - 85px);
      }
      .card-box {
        background: #121215;
        border: 1px solid #27272a;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .card-box.highlight {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(99, 102, 241, 0.1));
        border-color: #0284c7;
      }
      .btn {
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.15s ease;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn-primary {
        background: #0284c7;
        color: #ffffff;
      }
      .btn-primary:hover:not(:disabled) {
        background: #0369a1;
      }
      .btn-secondary {
        background: #27272a;
        color: #f4f4f5;
        border: 1px solid #3f3f46;
      }
      .btn-secondary:hover:not(:disabled) {
        background: #3f3f46;
      }
      .btn-danger {
        background: #dc2626;
        color: #ffffff;
      }
      .btn-danger:hover:not(:disabled) {
        background: #b91c1c;
      }
      .btn-sm {
        padding: 5px 8px;
        font-size: 10px;
      }
      .badge-pill {
        display: inline-flex;
        align-items: center;
        padding: 2px 7px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 600;
      }
      .badge-blue { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
      .badge-green { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
      .badge-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
      .badge-red { background: rgba(239, 68, 68, 0.15); color: #f87171; }
      .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
      .text-link {
        background: none;
        border: none;
        color: #38bdf8;
        cursor: pointer;
        padding: 0;
        font-size: 11px;
        text-decoration: underline;
      }
      .selected-video-card {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 6px;
        padding: 6px;
      }
      .selected-thumb {
        width: 48px;
        height: 27px;
        border-radius: 3px;
        object-fit: cover;
        background: #000;
      }
      .selected-info {
        flex: 1;
        min-width: 0;
      }
      .selected-title {
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #fafafa;
      }
      .selected-sub {
        font-size: 10px;
        color: #a1a1aa;
      }
      .progress-bar-container {
        width: 100%;
        background: #27272a;
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        margin: 6px 0;
      }
      .progress-bar-fill {
        height: 100%;
        background: #0284c7;
        transition: width 0.25s ease;
      }
      .progress-counter-row {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #d4d4d8;
        margin-top: 2px;
      }
      .failed-items-box {
        background: #18181b;
        border: 1px solid #ef4444;
        border-radius: 6px;
        padding: 6px 8px;
        max-height: 100px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .failed-item-entry {
        font-size: 11px;
        color: #fca5a5;
        line-height: 1.3;
      }
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(9, 9, 11, 0.95);
        backdrop-filter: blur(6px);
        padding: 14px;
        z-index: 100;
        display: flex;
        flex-direction: column;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .modal-title {
        font-size: 13px;
        font-weight: 700;
        color: #fafafa;
      }
      .modal-close-btn {
        background: transparent;
        border: none;
        color: #a1a1aa;
        font-size: 18px;
        cursor: pointer;
      }
      .video-results-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }
      .video-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .video-item:hover {
        background: #27272a;
        border-color: #3f3f46;
      }
      .video-item-title {
        font-size: 11px;
        font-weight: 600;
        color: #fafafa;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .video-item-meta {
        font-size: 10px;
        color: #a1a1aa;
      }
      .footer-note {
        padding: 8px 12px;
        background: #121215;
        border-top: 1px solid #27272a;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        color: #71717a;
      }
    `;

    // -------------------------------------------------------------
    // CALIBRATION STATUS / STUDIO CONNECTION (Prompt Section 8)
    // -------------------------------------------------------------
    let calibrationHtml = '';
    if (!this.hasTemplate) {
      calibrationHtml = `
        <div class="card-box" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08);">
          <div style="font-weight: 700; font-size: 12px; color: #fbbf24; margin-bottom: 2px;">
            Studio Connection
          </div>
          <div style="font-size: 11px; color: #e4e4e7; line-height: 1.4;">
            Before using ShortLinker for the first time:
            <ol style="margin: 6px 0 6px 18px; padding: 0;">
              <li>Open any Short.</li>
              <li>Change its Related Video manually.</li>
              <li>Save.</li>
              <li>Return to Shorts.</li>
            </ol>
          </div>
        </div>
      `;
    } else {
      calibrationHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #a1a1aa; padding: 2px 4px;">
          <span style="color: #4ade80; font-weight: 600;">✓ Studio Ready</span>
          <span style="font-size: 10px; color: #71717a;">Listing Page Mode</span>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // WORKFLOW CONTENT (Prompt Section 7)
    // -------------------------------------------------------------
    let workflowContent = '';

    if (!onShortsList) {
      workflowContent = `
        <div class="card-box" style="text-align: center; padding: 18px 10px;">
          <div style="font-weight: 600; font-size: 12px; color: #f4f4f5; margin-bottom: 4px;">
            Shorts List Standby
          </div>
          <div style="font-size: 11px; color: #a1a1aa; line-height: 1.4;">
            Open YouTube Studio &rarr; <b>Content &rarr; Shorts</b> to select Shorts and assign Related Videos.
          </div>
        </div>
      `;
    } else {
      // 1. Target Related Video Selector UI
      let targetSelectorHtml = '';
      if (this.selectedTargetVideo) {
        targetSelectorHtml = `
          <div class="card-box">
            <div style="font-size: 11px; font-weight: 600; color: #a1a1aa; display: flex; justify-content: space-between;">
              <span>Target:</span>
              <button class="text-link" id="btn-clear-target" style="color: #f87171;" ${isJobActive ? 'disabled' : ''}>Clear</button>
            </div>
            <div class="selected-video-card">
              <img
                src="${escapeHtml(this.selectedTargetVideo.thumbnailUrl || `https://i.ytimg.com/vi/${this.selectedTargetVideo.id}/mqdefault.jpg`)}"
                class="selected-thumb"
                alt="Thumbnail"
              />
              <div class="selected-info">
                <div class="selected-title" title="${escapeHtml(this.selectedTargetVideo.title)}">
                  ${escapeHtml(this.selectedTargetVideo.title)}
                </div>
                <div class="selected-sub">
                  ${this.selectedTargetVideo.duration ? `${this.selectedTargetVideo.duration} &bull; ` : ''}ID: <span class="mono">${this.selectedTargetVideo.id}</span>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-open-picker" ${isJobActive ? 'disabled' : ''}>Change</button>
            </div>
          </div>
        `;
      } else {
        targetSelectorHtml = `
          <div class="card-box">
            <div style="font-size: 11px; font-weight: 600; color: #a1a1aa;">
              Related Video:
            </div>
            <button class="btn btn-primary" id="btn-open-picker" style="width: 100%; padding: 9px 12px;" ${isJobActive ? 'disabled' : ''}>
              🔍 Choose Video
            </button>
            <div style="text-align: center; margin-top: 2px;">
              <button class="text-link" id="btn-toggle-manual" ${isJobActive ? 'disabled' : ''}>
                ${this.isManualFallbackOpen ? 'Hide manual entry' : 'Or enter YouTube link manually'}
              </button>
            </div>
            ${
              this.isManualFallbackOpen
                ? `
              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                <input
                  type="text"
                  id="manual-url-input"
                  placeholder="Paste YouTube watch URL or ID"
                  value="${escapeHtml(this.manualInputVal)}"
                  style="background: #09090b; border: 1px solid #3f3f46; color: #ffffff; padding: 6px 8px; border-radius: 6px; font-size: 11px;"
                  ${isJobActive ? 'disabled' : ''}
                />
                ${
                  this.manualInputError
                    ? `<div style="color: #f87171; font-size: 10px;">${escapeHtml(this.manualInputError)}</div>`
                    : ''
                }
              </div>`
                : ''
            }
          </div>
        `;
      }

      // 2. Selection Summary Bar
      const selectionBarHtml = `
        <div class="card-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; font-size: 12px; color: #f4f4f5;">Selected Shorts:</span>
            <span class="badge-pill ${selectedCount > 0 ? 'badge-blue' : 'badge-amber'}" style="font-size: 11px;">
              ${selectedCount}
            </span>
          </div>
          <div style="font-size: 10px; color: #a1a1aa;">
            ${
              selectedCount === 0
                ? 'Check one or more rows in Studio to link this video.'
                : selectedCount === 1
                ? '1 Short selected.'
                : `${selectedCount} Shorts selected in Studio.`
            }
          </div>
        </div>
      `;

      // 3. Execution Section: Running, Finished, or Idle (Prompt Section 7)
      let executionSectionHtml = '';

      if (this.bulkJobState === 'running') {
        const total = this.bulkItemsProgress.size;
        const succeededCount = Array.from(this.bulkItemsProgress.values()).filter(
          (it) => it.status === 'success'
        ).length;
        const failedCount = Array.from(this.bulkItemsProgress.values()).filter(
          (it) => it.status === 'failed'
        ).length;
        const processedCount = succeededCount + failedCount;
        const remainingCount = Math.max(0, total - processedCount);
        const percent = total > 0 ? Math.round((processedCount / total) * 100) : 0;

        executionSectionHtml = `
          <div class="card-box highlight">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; font-size: 12px; color: #38bdf8;">
                Applying Related Video
              </span>
              <button class="btn btn-danger btn-sm" id="btn-cancel-bulk" ${this.isStopping ? 'disabled' : ''}>
                ${this.isStopping ? 'Stopping...' : 'Stop'}
              </button>
            </div>
            
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${percent}%;"></div>
            </div>

            <div style="font-size: 11px; color: #f4f4f5; font-weight: 600;">
              ${processedCount} / ${total}
            </div>

            <div class="progress-counter-row">
              <span style="color: #4ade80;">Successful: ${succeededCount}</span>
              <span style="color: #f87171;">Failed: ${failedCount}</span>
              <span style="color: #a1a1aa;">Remaining: ${remainingCount}</span>
            </div>

            <div style="font-size: 10px; color: #94a3b8; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Current: <b class="mono" style="color: #e4e4e7;">${this.currentActiveShortId || 'Processing...'}</b>
            </div>
          </div>
        `;
      } else if (this.bulkJobState === 'done' || this.bulkJobState === 'cancelled') {
        const snapshot = this.lastJobSnapshot;
        const failedCount = snapshot?.failed ?? 0;
        const succeededCount = snapshot?.succeeded ?? 0;
        const notAttemptedCount = snapshot?.notAttempted ?? 0;
        const total = snapshot?.total ?? 0;
        const isFullSuccess = failedCount === 0 && notAttemptedCount === 0 && succeededCount > 0;

        if (isFullSuccess) {
          executionSectionHtml = `
            <div class="card-box" style="border-color: #059669; background: rgba(5, 150, 105, 0.1); text-align: center; padding: 14px;">
              <div style="font-size: 24px; margin-bottom: 4px;">🎉</div>
              <div style="font-weight: 700; font-size: 13px; color: #4ade80;">
                Completed
              </div>
              <div style="font-size: 11px; color: #d1d5db; margin-top: 4px;">
                ${succeededCount}/${total} Shorts updated successfully.
              </div>
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary btn-sm" id="btn-reset-bulk">Close</button>
              </div>
            </div>
          `;
        } else {
          const failedItems = snapshot?.items.filter((it) => it.status === 'failed') || [];
          const failedListHtml = failedItems
            .map(
              (it) => `
            <div class="failed-item-entry">
              <b class="mono">${it.sourceShortId}</b>: ${escapeHtml(it.classifiedError?.userMessage || it.error || 'Update failed')}
            </div>`
            )
            .join('');

          executionSectionHtml = `
            <div class="card-box" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08);">
              <div style="font-weight: 700; font-size: 12px; color: #f4f4f5;">
                Completed
              </div>

              <div class="progress-counter-row" style="margin-top: 2px;">
                <span style="color: #4ade80;">Successful: ${succeededCount}</span>
                <span style="color: #f87171;">Failed: ${failedCount}</span>
                <span style="color: #a1a1aa;">Not attempted: ${notAttemptedCount}</span>
              </div>

              ${
                failedItems.length > 0
                  ? `
                <div style="font-size: 11px; font-weight: 600; color: #fca5a5; margin-top: 6px;">
                  Failed:
                </div>
                <div class="failed-items-box">
                  ${failedListHtml}
                </div>`
                  : ''
              }

              <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px;">
                ${
                  failedCount > 0
                    ? `
                  <button class="btn btn-secondary btn-sm" id="btn-copy-failed">
                    📋 Copy Failed IDs
                  </button>
                  <button class="btn btn-primary btn-sm" id="btn-retry-failed">
                    Retry Failed (${failedCount})
                  </button>`
                    : ''
                }
                <button class="btn btn-secondary btn-sm" id="btn-reset-bulk">Close</button>
              </div>
            </div>
          `;
        }
      } else {
        // Idle State: Apply Button
        executionSectionHtml = `
          <div class="card-box highlight">
            <button
              class="btn btn-primary"
              id="btn-open-confirm-bulk"
              style="width: 100%; padding: 10px 14px; font-size: 12px;"
              ${!canApply ? 'disabled' : ''}
            >
              ${
                !this.hasTemplate
                  ? 'Studio Connection Required'
                  : selectedCount === 0
                  ? 'Select Shorts in Studio'
                  : !this.normalizedTargetId
                  ? 'Choose a Related Video'
                  : `Apply to ${selectedCount} Shorts`
              }
            </button>
          </div>
        `;
      }

      workflowContent = `
        ${calibrationHtml}
        ${selectionBarHtml}
        ${targetSelectorHtml}
        ${executionSectionHtml}
      `;
    }

    // -------------------------------------------------------------
    // CONFIRMATION MODAL OVERLAY (Prompt Section 14)
    // -------------------------------------------------------------
    let confirmationModalHtml = '';
    if (this.isConfirmingBulk) {
      confirmationModalHtml = `
        <div class="modal-overlay">
          <div class="modal-header">
            <span class="modal-title">Confirm Assignment</span>
            <button class="modal-close-btn" id="btn-close-confirm">&times;</button>
          </div>
          <div style="font-size: 12px; color: #f4f4f5; line-height: 1.4; margin-bottom: 12px;">
            Apply this Related Video to <b>${selectedCount}</b> selected Shorts?
          </div>
          <div class="selected-video-card" style="margin-bottom: 14px;">
            <img
              src="${escapeHtml(this.selectedTargetVideo?.thumbnailUrl || `https://i.ytimg.com/vi/${this.normalizedTargetId}/mqdefault.jpg`)}"
              class="selected-thumb"
              alt="Thumbnail"
            />
            <div class="selected-info">
              <div class="selected-title">
                ${escapeHtml(this.selectedTargetVideo?.title || 'Selected Video')}
              </div>
              <div class="selected-sub">
                ID: <span class="mono">${this.normalizedTargetId}</span>
              </div>
            </div>
          </div>
          <div style="font-size: 11px; color: #a1a1aa; line-height: 1.4; margin-bottom: 14px;">
            ShortLinker will update the selected Shorts directly on this page without opening editor tabs.
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: auto;">
            <button class="btn btn-secondary" id="btn-close-confirm">Cancel</button>
            <button class="btn btn-primary" id="btn-start-bulk-confirmed">Confirm &amp; Apply</button>
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // SEARCHABLE TARGET VIDEO PICKER MODAL (Prompt Section 12)
    // -------------------------------------------------------------
    let pickerModalHtml = '';
    if (this.isPickerOpen) {
      const filteredVideos = this.catalogStore.search(this.searchQuery);
      const resultsItemsHtml =
        filteredVideos.length > 0
          ? filteredVideos
              .slice(0, 40)
              .map(
                (v) => `
            <div class="video-item" data-video-id="${v.id}">
              <img
                src="${escapeHtml(v.thumbnailUrl || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`)}"
                class="selected-thumb"
                alt="Thumb"
                loading="lazy"
              />
              <div style="flex: 1; min-width: 0;">
                <div class="video-item-title" title="${escapeHtml(v.title)}">
                  ${escapeHtml(v.title)}
                </div>
                <div class="video-item-meta">
                  ${v.duration ? `${v.duration} &bull; ` : ''}ID: <span class="mono">${v.id}</span>
                </div>
              </div>
            </div>
          `
              )
              .join('')
          : `
            <div style="text-align: center; color: #71717a; padding: 24px 10px; font-size: 11px;">
              No matching videos found.<br>
              <button class="text-link" id="btn-retry-catalog" style="margin-top: 6px;">Refresh List</button>
            </div>
          `;

      pickerModalHtml = `
        <div class="modal-overlay">
          <div class="modal-header">
            <span class="modal-title">Choose Related Video</span>
            <button class="modal-close-btn" id="btn-close-picker">&times;</button>
          </div>
          <input
            type="text"
            id="picker-search-input"
            placeholder="Search by title or video ID..."
            value="${escapeHtml(this.searchQuery)}"
            style="width: 100%; background: #18181b; border: 1px solid #3f3f46; color: #ffffff; padding: 8px 10px; border-radius: 6px; font-size: 12px;"
          />
          <div class="video-results-list">
            ${resultsItemsHtml}
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // OPTIONAL LOCAL DIAGNOSTICS (OFF by default)
    // -------------------------------------------------------------
    let diagnosticsHtml = '';
    if (this.showDiagnostics) {
      diagnosticsHtml = `
        <div class="card-box" style="margin-top: 10px; border-color: #3f3f46;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; font-size: 11px; color: #e4e4e7;">Local Diagnostics</span>
            <button class="btn btn-secondary btn-sm" id="btn-toggle-diag-mode">
              ${this.diagManager.getDebugLevel() > 0 ? 'Disable' : 'Enable'}
            </button>
          </div>
          <div style="font-size: 10px; color: #a1a1aa; line-height: 1.4;">
            Local diagnostics are optional and never collect or transmit credentials.
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm" id="btn-export-json">
              📥 Export JSON
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-copy-chatgpt">
              📋 Copy Report
            </button>
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // FULL RENDER
    // -------------------------------------------------------------
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="panel-container">
        ${confirmationModalHtml}
        ${pickerModalHtml}

        <div class="header-row">
          <div class="title-group">
            <span class="main-title">ShortLinker</span>
            <span class="sub-title">Related Video Manager</span>
          </div>
          <button class="minimize-btn" id="min-btn" title="Minimize">_</button>
        </div>

        <div class="scroll-body">
          ${workflowContent}
          ${diagnosticsHtml}
        </div>

        <div class="footer-note">
          <button class="text-link" id="btn-toggle-diag" style="font-size: 10px; color: #71717a;">
            ${this.showDiagnostics ? 'Hide Diagnostics' : 'Diagnostics'}
          </button>
          <span>Chrome Extension</span>
        </div>
      </div>
    `;

    // -------------------------------------------------------------
    // EVENT BINDINGS
    // -------------------------------------------------------------
    this.shadowRoot.getElementById('min-btn')?.addEventListener('click', () => {
      this.toggleMinimize();
    });

    this.shadowRoot.getElementById('btn-toggle-diag')?.addEventListener('click', () => {
      this.showDiagnostics = !this.showDiagnostics;
      this.render();
    });

    // Picker Open / Close
    this.shadowRoot.getElementById('btn-open-picker')?.addEventListener('click', () => {
      if (isJobActive) return;
      this.isPickerOpen = true;
      this.searchQuery = '';
      if (this.catalogStore.count() === 0) {
        this.requestCatalogRefresh();
      }
      this.render();
      setTimeout(() => {
        const searchInput = this.shadowRoot?.getElementById('picker-search-input') as HTMLInputElement | null;
        searchInput?.focus();
      }, 50);
    });

    this.shadowRoot.getElementById('btn-close-picker')?.addEventListener('click', () => {
      this.isPickerOpen = false;
      this.render();
    });

    this.shadowRoot.getElementById('btn-clear-target')?.addEventListener('click', () => {
      if (isJobActive) return;
      this.clearTargetVideo();
    });

    this.shadowRoot.getElementById('btn-toggle-manual')?.addEventListener('click', () => {
      if (isJobActive) return;
      this.isManualFallbackOpen = !this.isManualFallbackOpen;
      this.render();
    });

    this.shadowRoot.getElementById('btn-retry-catalog')?.addEventListener('click', () => {
      this.requestCatalogRefresh();
    });

    // Search input binding
    const searchInputEl = this.shadowRoot.getElementById('picker-search-input') as HTMLInputElement | null;
    searchInputEl?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.render();
      setTimeout(() => {
        const inp = this.shadowRoot?.getElementById('picker-search-input') as HTMLInputElement | null;
        if (inp) {
          inp.focus();
          inp.selectionStart = inp.selectionEnd = inp.value.length;
        }
      }, 10);
    });

    // Video item selection
    this.shadowRoot.querySelectorAll<HTMLElement>('.video-item').forEach((itemEl) => {
      itemEl.addEventListener('click', () => {
        const vId = itemEl.getAttribute('data-video-id');
        if (vId) {
          const video = this.catalogStore.getById(vId);
          if (video) {
            this.selectTargetVideo(video);
          }
        }
      });
    });

    // Manual input binding
    const manualInputEl = this.shadowRoot.getElementById('manual-url-input') as HTMLInputElement | null;
    manualInputEl?.addEventListener('input', (e) => {
      this.handleManualInput((e.target as HTMLInputElement).value);
    });

    // Bulk Confirmation Modal bindings
    this.shadowRoot.getElementById('btn-open-confirm-bulk')?.addEventListener('click', () => {
      if (isJobActive || !canApply) return;
      this.isConfirmingBulk = true;
      this.render();
    });

    this.shadowRoot.getElementById('btn-close-confirm')?.addEventListener('click', () => {
      this.isConfirmingBulk = false;
      this.render();
    });

    this.shadowRoot.getElementById('btn-start-bulk-confirmed')?.addEventListener('click', () => {
      this.executeBulkAssignment();
    });

    this.shadowRoot.getElementById('btn-cancel-bulk')?.addEventListener('click', () => {
      this.cancelBulkJob();
    });

    this.shadowRoot.getElementById('btn-reset-bulk')?.addEventListener('click', () => {
      this.bulkJobState = 'idle';
      this.bulkSummary = null;
      this.bulkItemsProgress.clear();
      this.render();
    });

    this.shadowRoot.getElementById('btn-retry-failed')?.addEventListener('click', () => {
      this.retryFailedItems();
    });

    const copyFailedBtn = this.shadowRoot.getElementById('btn-copy-failed') as HTMLButtonElement | null;
    copyFailedBtn?.addEventListener('click', () => {
      this.copyFailedIds(copyFailedBtn);
    });

    // Diagnostic Console Bindings
    this.shadowRoot.getElementById('btn-toggle-diag-mode')?.addEventListener('click', () => {
      this.toggleDiagnosticsMode();
    });

    this.shadowRoot.getElementById('btn-export-json')?.addEventListener('click', () => {
      this.diagManager.exportSessionJson();
    });

    const copyChatGptBtn = this.shadowRoot.getElementById('btn-copy-chatgpt') as HTMLButtonElement | null;
    copyChatGptBtn?.addEventListener('click', () => {
      const report = this.diagManager.generateMarkdownReport();
      this.copyToClipboard(report, copyChatGptBtn);
    });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
