import {
  StudioPageContext,
  CapturedRequest,
  RelatedVideoMutationMeta,
  ReplayResult,
  MutationItemProgress,
  MutationJobSummary,
  MutationExecutePayload,
  ImmutableJobSnapshot,
  TargetVideo,
  BRIDGE_EVENTS
} from '../types';
import { normalizeYouTubeVideoId } from '../common/youtube';
import { classifyError } from '../common/error-classifier';
import { VideoCatalogStore } from '../common/video-catalog';
import { isShortsListView } from './detector';

export class DevIndicatorUI {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private currentContext: StudioPageContext | null = null;
  private navCount = 0;
  private isMinimized = false;

  // Onboarding & Advanced Mode
  private isOnboardingDismissed = false;
  private showAdvanced = false;
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

  // Network Inspector State
  private isCaptureActive = false;
  private capturedRequests: CapturedRequest[] = [];
  private activeMutation: RelatedVideoMutationMeta | null = null;
  private replayState: 'idle' | 'confirming' | 'replaying' | 'done' = 'idle';
  private replayResult: ReplayResult | null = null;

  // Shorts List View State
  private selectedShortIds: string[] = [];
  private hasTemplate = false;
  private hasSingleTestSucceeded = false;
  private isGateBypassed = false;

  // Single test state
  private singleTestState: 'idle' | 'confirming' | 'running' | 'done' = 'idle';
  private singleTestResult: MutationItemProgress | null = null;

  // Bulk execution state
  private bulkJobState: 'idle' | 'running' | 'cancelled' | 'done' = 'idle';
  private bulkItemsProgress: Map<string, MutationItemProgress> = new Map();
  private bulkSummary: MutationJobSummary | null = null;
  private lastJobSnapshot: ImmutableJobSnapshot | null = null;
  private currentJobId: string | null = null;

  public mount(initialContext: StudioPageContext): void {
    if (this.hostElement) return;

    this.currentContext = initialContext;
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'shortlinker-poc-root';
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    document.body.appendChild(this.hostElement);

    // Check template status in MAIN world
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.TEMPLATE_STATUS_REQUEST));

    // Request creator videos catalog from MAIN world
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.CATALOG_REQUEST));

    // Extract any existing DOM video rows as immediate fallback
    this.catalogStore.extractFromDom();

    // Listen for catalog updates from MAIN world
    document.addEventListener(BRIDGE_EVENTS.CATALOG_RESPONSE, ((event: CustomEvent<{ videos: TargetVideo[] }>) => {
      if (event.detail && Array.isArray(event.detail.videos)) {
        this.catalogStore.addVideos(event.detail.videos);
        this.render();
      }
    }) as EventListener);

    document.addEventListener(BRIDGE_EVENTS.TEMPLATE_STATUS_RESPONSE, ((event: CustomEvent<{ hasTemplate: boolean }>) => {
      if (event.detail) {
        this.hasTemplate = event.detail.hasTemplate;
        this.render();
      }
    }) as EventListener);

    document.addEventListener(BRIDGE_EVENTS.CAPTURE, ((event: CustomEvent<CapturedRequest>) => {
      if (event.detail) {
        this.addCapturedRequest(event.detail);
      }
    }) as EventListener);

    document.addEventListener(BRIDGE_EVENTS.MUTATION_DETECTED, ((event: CustomEvent<RelatedVideoMutationMeta>) => {
      if (event.detail) {
        this.activeMutation = event.detail;
        this.hasTemplate = true;
        this.replayState = 'idle';
        this.replayResult = null;
        this.render();
      }
    }) as EventListener);

    document.addEventListener(BRIDGE_EVENTS.REPLAY_RESPONSE, ((event: CustomEvent<ReplayResult>) => {
      if (event.detail) {
        this.replayResult = event.detail;
        this.replayState = 'done';
        if (event.detail.success) {
          this.hasSingleTestSucceeded = true;
        }
        this.render();
      }
    }) as EventListener);

    // Bulk / Single execution progress
    document.addEventListener(BRIDGE_EVENTS.MUTATION_PROGRESS, ((event: CustomEvent<MutationItemProgress>) => {
      if (event.detail) {
        const item = event.detail;
        if (this.singleTestState === 'running') {
          if (item.status === 'success' || item.status === 'failed') {
            this.singleTestResult = item;
            this.singleTestState = 'done';
            if (item.status === 'success') {
              this.hasSingleTestSucceeded = true;
            }
          }
        } else if (this.bulkJobState === 'running') {
          this.bulkItemsProgress.set(item.sourceShortId, item);
        }
        this.render();
      }
    }) as EventListener);

    document.addEventListener(BRIDGE_EVENTS.MUTATION_COMPLETE, ((event: CustomEvent<MutationJobSummary>) => {
      if (event.detail) {
        this.bulkSummary = event.detail;
        this.bulkJobState = event.detail.isCancelled ? 'cancelled' : 'done';
        if (event.detail.succeeded > 0) {
          this.hasSingleTestSucceeded = true;
        }

        // Create immutable job snapshot
        this.lastJobSnapshot = Object.freeze({
          jobId: event.detail.jobId,
          targetVideoId: this.normalizedTargetId || '',
          targetVideoTitle: this.selectedTargetVideo?.title,
          total: event.detail.total,
          completed: event.detail.completed,
          succeeded: event.detail.succeeded,
          failed: event.detail.failed,
          notAttempted: event.detail.notAttempted ?? 0,
          isCancelled: event.detail.isCancelled,
          items: Object.freeze([...event.detail.items]),
          failedItemIds: Object.freeze([...(event.detail.failedItemIds || [])]),
          finishedAt: new Date().toLocaleTimeString()
        });

        this.render();
      }
    }) as EventListener);

    this.render();
  }

  public updateContext(context: StudioPageContext): void {
    this.currentContext = context;
    this.navCount++;
    this.catalogStore.extractFromDom();
    this.render();
  }

  public updateSelection(selectedIds: string[]): void {
    this.selectedShortIds = selectedIds;
    if (this.singleTestState === 'done') {
      this.singleTestState = 'idle';
      this.singleTestResult = null;
    }
    if (this.bulkJobState === 'done' || this.bulkJobState === 'cancelled') {
      this.bulkJobState = 'idle';
      this.bulkSummary = null;
      this.bulkItemsProgress.clear();
    }
    this.render();
  }

  public addCapturedRequest(req: CapturedRequest): void {
    this.capturedRequests.unshift(req);
    if (this.capturedRequests.length > 50) {
      this.capturedRequests.pop();
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
      this.manualInputError = res.error || 'Invalid YouTube URL or ID';
    }
    this.render();
  }

  private requestCatalogRefresh(): void {
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REFRESH_CATALOG));
  }

  private executeSingleShortTest(): void {
    if (!this.normalizedTargetId || this.selectedShortIds.length === 0) return;

    const sourceShortId = this.selectedShortIds[0];
    this.singleTestState = 'running';
    this.singleTestResult = null;
    this.render();

    const payload: MutationExecutePayload = {
      jobId: `single_${Date.now()}`,
      sourceShortIds: [sourceShortId],
      targetVideoId: this.normalizedTargetId,
      delayMs: 0
    };

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.EXECUTE_MUTATION, { detail: payload }));
  }

  private executeBulkAssignment(idsToRun?: string[]): void {
    const ids = idsToRun || this.selectedShortIds;
    if (!this.normalizedTargetId || ids.length === 0) return;

    this.isConfirmingBulk = false;
    this.bulkJobState = 'running';
    this.bulkSummary = null;
    this.bulkItemsProgress.clear();
    this.currentJobId = `bulk_${Date.now()}`;

    for (const id of ids) {
      this.bulkItemsProgress.set(id, {
        sourceShortId: id,
        targetVideoId: this.normalizedTargetId,
        status: 'queued'
      });
    }
    this.render();

    const payload: MutationExecutePayload = {
      jobId: this.currentJobId,
      sourceShortIds: ids,
      targetVideoId: this.normalizedTargetId,
      delayMs: 800
    };

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.EXECUTE_MUTATION, { detail: payload }));
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
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.CANCEL_MUTATION));
  }

  private toggleCapture(): void {
    this.isCaptureActive = !this.isCaptureActive;
    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.CONTROL, {
        detail: { enabled: this.isCaptureActive }
      })
    );
    this.render();
  }

  private toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    this.render();
  }

  private copyToClipboard(text: string, buttonEl: HTMLButtonElement): void {
    navigator.clipboard.writeText(text).then(
      () => {
        const orig = buttonEl.textContent;
        buttonEl.textContent = 'Copied!';
        setTimeout(() => {
          buttonEl.textContent = orig;
        }, 1500);
      },
      (err) => console.error('Failed to copy text: ', err)
    );
  }

  private render(): void {
    if (!this.shadowRoot || !this.currentContext) return;

    const onShortsList = isShortsListView();
    const selectedCount = this.selectedShortIds.length;

    const css = `
      :host {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.4;
      }
      .panel-container {
        position: relative;
        background: #18181b;
        color: #f4f4f5;
        border: 1px solid #3f3f46;
        border-radius: 12px;
        box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.75), 0 8px 12px -6px rgba(0, 0, 0, 0.5);
        padding: 14px 16px;
        width: 430px;
        max-width: 92vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(10px);
        transition: all 0.2s ease-in-out;
      }
      .panel-container.minimized {
        width: auto;
        padding: 8px 14px;
        border-radius: 20px;
        cursor: pointer;
        display: block;
      }
      .header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .title-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pulse-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: ${onShortsList ? '#22c55e' : '#71717a'};
        box-shadow: ${onShortsList ? '0 0 0 2px rgba(34, 197, 94, 0.3)' : 'none'};
      }
      .main-title {
        font-weight: 600;
        font-size: 13px;
        color: #fafafa;
        letter-spacing: -0.01em;
      }
      .minimize-btn {
        background: transparent;
        border: none;
        color: #a1a1aa;
        cursor: pointer;
        padding: 2px 6px;
        font-size: 12px;
        border-radius: 4px;
      }
      .minimize-btn:hover {
        background: #27272a;
        color: #fafafa;
      }
      .scroll-body {
        overflow-y: auto;
        max-height: 580px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-right: 2px;
      }
      .scroll-body::-webkit-scrollbar {
        width: 4px;
      }
      .scroll-body::-webkit-scrollbar-thumb {
        background: #3f3f46;
        border-radius: 4px;
      }

      /* Card boxes */
      .card-box {
        background: #202023;
        border: 1px solid #3f3f46;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .card-box.highlight {
        border-color: #0284c7;
      }

      /* Onboarding banner */
      .onboarding-banner {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.15), rgba(99, 102, 241, 0.15));
        border: 1px solid #0284c7;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        position: relative;
      }
      .onboarding-title {
        font-weight: 600;
        font-size: 11px;
        color: #38bdf8;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .onboarding-steps {
        font-size: 11px;
        color: #d1d5db;
        line-height: 1.4;
      }

      /* Target Video Card */
      .selected-video-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        background: #09090b;
        border: 1px solid #059669;
        border-radius: 6px;
      }
      .selected-thumb {
        width: 68px;
        height: 38px;
        border-radius: 4px;
        object-fit: cover;
        background: #27272a;
        flex-shrink: 0;
      }
      .selected-info {
        flex: 1;
        overflow: hidden;
      }
      .selected-title {
        font-size: 11px;
        font-weight: 600;
        color: #f4f4f5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .selected-sub {
        font-size: 10px;
        color: #9ca3af;
        margin-top: 1px;
      }
      .text-link {
        background: none;
        border: none;
        color: #38bdf8;
        font-size: 11px;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
      }
      .text-link:hover {
        color: #7dd3fc;
      }

      /* Modal Popovers */
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(8px);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        padding: 14px;
        z-index: 100;
        box-shadow: inset 0 0 0 1px #3f3f46;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .modal-title {
        font-weight: 600;
        font-size: 12px;
        color: #ffffff;
      }
      .modal-close-btn {
        background: transparent;
        border: none;
        color: #a1a1aa;
        font-size: 18px;
        cursor: pointer;
        line-height: 1;
      }
      .modal-close-btn:hover {
        color: #ffffff;
      }
      .search-input {
        background: #09090b;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 8px 10px;
        color: #ffffff;
        font-size: 12px;
        outline: none;
        margin-bottom: 8px;
      }
      .search-input:focus {
        border-color: #0284c7;
      }
      .video-results-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-right: 2px;
      }
      .video-results-list::-webkit-scrollbar {
        width: 4px;
      }
      .video-results-list::-webkit-scrollbar-thumb {
        background: #3f3f46;
        border-radius: 4px;
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
        transition: all 0.15s ease;
      }
      .video-item:hover {
        background: #27272a;
        border-color: #0284c7;
      }
      .video-item-thumb {
        width: 56px;
        height: 32px;
        border-radius: 4px;
        object-fit: cover;
        background: #09090b;
        flex-shrink: 0;
      }
      .video-item-info {
        flex: 1;
        overflow: hidden;
      }
      .video-item-title {
        font-size: 11px;
        font-weight: 600;
        color: #f4f4f5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .video-item-meta {
        font-size: 10px;
        color: #a1a1aa;
        display: flex;
        gap: 6px;
        margin-top: 2px;
      }

      /* Badges & Buttons */
      .badge-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 600;
      }
      .badge-green {
        background: rgba(34, 197, 94, 0.15);
        color: #4ade80;
      }
      .badge-amber {
        background: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
      }
      .badge-blue {
        background: rgba(2, 132, 199, 0.15);
        color: #38bdf8;
      }
      .btn {
        border: none;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: opacity 0.15s ease;
      }
      .btn:hover:not(:disabled) {
        opacity: 0.9;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn-primary {
        background: #0284c7;
        color: #ffffff;
      }
      .btn-success {
        background: #059669;
        color: #ffffff;
      }
      .btn-danger {
        background: #dc2626;
        color: #ffffff;
      }
      .btn-secondary {
        background: #27272a;
        color: #e4e4e7;
        border: 1px solid #3f3f46;
      }
      .btn-sm {
        padding: 4px 8px;
        font-size: 10px;
      }

      /* Progress Bar & Items */
      .progress-bar-container {
        width: 100%;
        height: 8px;
        background: #27272a;
        border-radius: 4px;
        overflow: hidden;
        margin: 6px 0;
      }
      .progress-bar-fill {
        height: 100%;
        background: #0284c7;
        transition: width 0.3s ease;
        border-radius: 4px;
      }
      .progress-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 160px;
        overflow-y: auto;
        border: 1px solid #27272a;
        border-radius: 6px;
        padding: 6px;
        background: #09090b;
      }
      .progress-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        padding: 3px 6px;
        border-radius: 4px;
      }
      .progress-row.success {
        color: #4ade80;
      }
      .progress-row.failed {
        color: #f87171;
        background: rgba(239, 68, 68, 0.08);
      }
      .progress-row.running {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.1);
      }
      .progress-row.queued {
        color: #71717a;
      }
      .progress-row.not_attempted {
        color: #9ca3af;
        opacity: 0.7;
      }

      /* Failed list in summary */
      .failed-items-box {
        background: #18181b;
        border: 1px solid #ef4444;
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 140px;
        overflow-y: auto;
      }
      .failed-item-entry {
        font-size: 10px;
        color: #fca5a5;
        line-height: 1.35;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .code-box {
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 4px;
        padding: 6px;
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: #a1a1aa;
        max-height: 100px;
        overflow-y: auto;
        white-space: pre-wrap;
        margin: 0;
      }
      .footer-note {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #27272a;
        font-size: 10px;
        color: #71717a;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    `;

    if (this.isMinimized) {
      this.shadowRoot.innerHTML = `
        <style>${css}</style>
        <div class="panel-container minimized" id="expand-trigger">
          <div class="title-group">
            <span class="pulse-dot"></span>
            <span class="main-title">ShortLinker (${selectedCount} selected)</span>
          </div>
        </div>
      `;
      this.shadowRoot.getElementById('expand-trigger')?.addEventListener('click', () => {
        this.toggleMinimize();
      });
      return;
    }

    // -------------------------------------------------------------
    // ONBOARDING BANNER (Dismissible)
    // -------------------------------------------------------------
    let onboardingHtml = '';
    if (!this.isOnboardingDismissed) {
      onboardingHtml = `
        <div class="onboarding-banner">
          <div class="onboarding-title">
            <span>✨ Fast Setup</span>
            <button class="modal-close-btn" id="btn-dismiss-onboarding" style="font-size: 14px;">&times;</button>
          </div>
          <div class="onboarding-steps">
            1. Select one or more Shorts in YouTube Studio's table.<br>
            2. Choose your Related Video.<br>
            3. Click Assign to update them safely in your session.
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // SHORTS LIST WORKFLOW CONTENT
    // -------------------------------------------------------------
    let workflowContent = '';

    if (!onShortsList) {
      workflowContent = `
        <div class="card-box" style="text-align: center; padding: 18px 10px;">
          <div style="font-weight: 600; font-size: 12px; color: #f4f4f5; margin-bottom: 4px;">
            Shorts List View Standby
          </div>
          <div style="font-size: 11px; color: #a1a1aa; line-height: 1.4;">
            Navigate to <b>Content &rarr; Shorts</b> in YouTube Studio to select Shorts and assign Related Videos.
          </div>
        </div>
      `;
    } else {
      // Session status hint
      const sessionHintHtml = !this.hasTemplate
        ? `
        <div class="card-box" style="border-color: #d97706; background: rgba(217, 119, 6, 0.1);">
          <div style="font-weight: 600; color: #fbbf24; font-size: 11px;">
            Session Authorization Required
          </div>
          <div style="font-size: 11px; color: #d1d5db; line-height: 1.35;">
            To link videos through your session, YouTube requires an active session token.
            Please open any Short in Studio and save a Related Video manually once to activate.
          </div>
        </div>`
        : `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #a1a1aa; padding: 0 2px;">
          <span>Studio Session: <span style="color: #4ade80; font-weight: 600;">Connected</span></span>
          <span style="font-size: 10px;">Zero credentials stored</span>
        </div>`;

      // Target Related Video Selection UI
      let targetSelectorHtml = '';
      if (this.selectedTargetVideo) {
        targetSelectorHtml = `
          <div class="card-box">
            <div style="font-size: 11px; font-weight: 600; color: #a1a1aa; display: flex; justify-content: space-between;">
              <span>Target Related Video:</span>
              <button class="text-link" id="btn-clear-target" style="color: #f87171;">Clear</button>
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
              <button class="btn btn-secondary btn-sm" id="btn-open-picker">Change</button>
            </div>
          </div>
        `;
      } else {
        targetSelectorHtml = `
          <div class="card-box">
            <div style="font-size: 11px; font-weight: 600; color: #a1a1aa;">
              Related Video:
            </div>
            <button class="btn btn-primary" id="btn-open-picker" style="width: 100%; padding: 9px 12px;">
              🔍 Select Related Video
            </button>
            <div style="text-align: center; margin-top: 2px;">
              <button class="text-link" id="btn-toggle-manual">
                ${this.isManualFallbackOpen ? "Hide manual entry" : "Or enter YouTube URL / ID manually"}
              </button>
            </div>
            ${
              this.isManualFallbackOpen
                ? `
              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                <input
                  type="text"
                  id="manual-url-input"
                  class="input-text"
                  placeholder="Paste YouTube watch URL or ID"
                  value="${escapeHtml(this.manualInputVal)}"
                  style="background: #09090b; border: 1px solid #3f3f46; color: #ffffff; padding: 6px 8px; border-radius: 6px;"
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

      // Selection Summary Bar
      const selectionBarHtml = `
        <div class="card-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; font-size: 12px; color: #f4f4f5;">Selected Shorts:</span>
            <span class="badge-pill ${selectedCount > 0 ? 'badge-blue' : 'badge-amber'}" style="font-size: 11px;">
              ${selectedCount} Short${selectedCount === 1 ? '' : 's'}
            </span>
          </div>
          <div style="font-size: 10px; color: #a1a1aa;">
            ${
              selectedCount === 0
                ? 'Check one or more rows in Studio to link this video.'
                : selectedCount === 1
                ? `1 Short selected (${this.selectedShortIds[0]}).`
                : `${selectedCount} Shorts selected in Studio.`
            }
          </div>
        </div>
      `;

      // Execution States: Idle, Running, Done
      let executionSectionHtml = '';

      if (this.bulkJobState === 'running') {
        const total = selectedCount;
        const completedCount = Array.from(this.bulkItemsProgress.values()).filter(
          (it) => it.status === 'success' || it.status === 'failed' || it.status === 'cancelled' || it.status === 'not_attempted'
        ).length;
        const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

        const progressRowsHtml = Array.from(this.bulkItemsProgress.values())
          .map((it) => {
            const icon =
              it.status === 'success'
                ? '✓'
                : it.status === 'failed'
                ? '✗'
                : it.status === 'running'
                ? '⟳'
                : it.status === 'not_attempted'
                ? '⏸'
                : '○';
            return `
              <div class="progress-row ${it.status}">
                <span>${icon} <span class="mono">${it.sourceShortId}</span></span>
                <span>${it.status === 'running' ? 'Updating...' : it.status.toUpperCase()}</span>
              </div>
            `;
          })
          .join('');

        executionSectionHtml = `
          <div class="card-box highlight">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600; font-size: 12px; color: #38bdf8;">
                Updating: ${completedCount} / ${total} (${percent}%)
              </span>
              <button class="btn btn-danger btn-sm" id="btn-cancel-bulk">
                Stop
              </button>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${percent}%;"></div>
            </div>
            <div class="progress-list">
              ${progressRowsHtml}
            </div>
          </div>
        `;
      } else if (this.bulkJobState === 'done' || this.bulkJobState === 'cancelled') {
        const snapshot = this.lastJobSnapshot;
        const isCancelled = snapshot?.isCancelled;
        const failedCount = snapshot?.failed ?? 0;
        const succeededCount = snapshot?.succeeded ?? 0;
        const notAttemptedCount = snapshot?.notAttempted ?? 0;
        const isFullSuccess = failedCount === 0 && notAttemptedCount === 0;

        let resultSummaryHtml = '';

        if (isFullSuccess) {
          resultSummaryHtml = `
            <div class="card-box" style="border-color: #059669; background: rgba(5, 150, 105, 0.1); text-align: center; padding: 14px;">
              <div style="font-size: 24px; margin-bottom: 4px;">🎉</div>
              <div style="font-weight: 700; font-size: 13px; color: #4ade80;">
                All ${succeededCount} Shorts Updated!
              </div>
              <div style="font-size: 11px; color: #d1d5db; margin-top: 4px;">
                Related video successfully assigned to all selected Shorts.
              </div>
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary btn-sm" id="btn-reset-bulk">Done</button>
              </div>
            </div>
          `;
        } else {
          // Partial failure or cancelled
          const failedItems = snapshot?.items.filter((it) => it.status === 'failed') || [];
          const failedListHtml = failedItems
            .map(
              (it) => `
            <div class="failed-item-entry">
              <b>${it.sourceShortId}</b>: ${escapeHtml(it.classifiedError?.userMessage || it.error || 'Update failed')}
            </div>`
            )
            .join('');

          resultSummaryHtml = `
            <div class="card-box" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; font-size: 12px; color: #f4f4f5;">
                  ${isCancelled ? 'Operation Stopped' : 'Update Finished with Issues'}
                </span>
                <span class="badge-pill badge-amber">
                  ${succeededCount} OK &bull; ${failedCount} Failed ${notAttemptedCount > 0 ? `&bull; ${notAttemptedCount} Skipped` : ''}
                </span>
              </div>

              ${
                failedItems.length > 0
                  ? `
                <div style="font-size: 11px; font-weight: 600; color: #fca5a5; margin-top: 4px;">
                  Failed Shorts:
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
                    ⟳ Retry Failed (${failedCount})
                  </button>`
                    : ''
                }
                <button class="btn btn-secondary btn-sm" id="btn-reset-bulk">Close</button>
              </div>
            </div>
          `;
        }

        executionSectionHtml = resultSummaryHtml;
      } else if (selectedCount === 0) {
        executionSectionHtml = `
          <div style="text-align: center; color: #71717a; font-size: 11px; padding: 8px 0;">
            Select one or more Shorts using YouTube Studio's checkboxes to proceed.
          </div>
        `;
      } else if (selectedCount === 1) {
        // Single Short
        const singleShortId = this.selectedShortIds[0];
        if (this.singleTestState === 'running') {
          executionSectionHtml = `
            <div class="card-box" style="text-align: center; padding: 14px;">
              <span class="badge-pill badge-blue" style="margin-bottom: 6px;">Updating Short...</span>
              <div class="mono" style="font-size: 11px; color: #38bdf8;">${singleShortId} &rarr; ${this.normalizedTargetId}</div>
            </div>
          `;
        } else if (this.singleTestState === 'done' && this.singleTestResult) {
          const isSuccess = this.singleTestResult.status === 'success';
          executionSectionHtml = `
            <div class="card-box" style="border-color: ${isSuccess ? '#059669' : '#dc2626'}; background: ${
            isSuccess ? 'rgba(5, 150, 105, 0.1)' : 'rgba(220, 38, 38, 0.1)'
          };">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; font-size: 11px; color: ${isSuccess ? '#4ade80' : '#f87171'};">
                  ${isSuccess ? 'Success' : 'Update Failed'}
                </span>
                <span class="badge-pill ${isSuccess ? 'badge-green' : 'badge-amber'}">
                  ${this.singleTestResult.durationMs ?? 0}ms
                </span>
              </div>
              <div style="font-size: 11px; color: #f3f4f6;">
                Short <span class="mono">${singleShortId}</span> &rarr; Target <span class="mono">${this.normalizedTargetId}</span>
              </div>
              ${
                this.singleTestResult.error
                  ? `<div style="font-size: 10px; color: #fca5a5;"><b>Reason:</b> ${escapeHtml(
                      this.singleTestResult.error
                    )}</div>`
                  : ''
              }
              <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                <button class="btn btn-secondary btn-sm" id="btn-single-test-confirm">Run Again</button>
              </div>
            </div>
          `;
        } else {
          executionSectionHtml = `
            <div class="card-box highlight">
              <button
                class="btn btn-primary"
                id="btn-single-test-confirm"
                style="width: 100%; padding: 9px;"
                ${!this.normalizedTargetId || !this.hasTemplate ? 'disabled' : ''}
              >
                Assign to Selected Short
              </button>
            </div>
          `;
        }
      } else {
        // Multi-Short Bulk Action
        executionSectionHtml = `
          <div class="card-box highlight">
            <button
              class="btn btn-primary"
              id="btn-open-confirm-bulk"
              style="width: 100%; padding: 10px; font-size: 12px;"
              ${!this.normalizedTargetId || !this.hasTemplate ? 'disabled' : ''}
            >
              Assign to ${selectedCount} Selected Shorts
            </button>
          </div>
        `;
      }

      workflowContent = `
        ${sessionHintHtml}
        ${targetSelectorHtml}
        ${selectionBarHtml}
        ${executionSectionHtml}
      `;
    }

    // -------------------------------------------------------------
    // CONFIRMATION MODAL OVERLAY
    // -------------------------------------------------------------
    let confirmationModalHtml = '';
    if (this.isConfirmingBulk) {
      confirmationModalHtml = `
        <div class="modal-overlay">
          <div class="modal-header">
            <span class="modal-title">Confirm Bulk Assignment</span>
            <button class="modal-close-btn" id="btn-close-confirm">&times;</button>
          </div>
          <div style="font-size: 12px; color: #f4f4f5; line-height: 1.4; margin-bottom: 12px;">
            You are about to assign this Related Video to <b>${selectedCount}</b> selected Shorts:
          </div>
          <div class="selected-video-card" style="margin-bottom: 14px;">
            <img
              src="${escapeHtml(this.selectedTargetVideo?.thumbnailUrl || `https://i.ytimg.com/vi/${this.normalizedTargetId}/mqdefault.jpg`)}"
              class="selected-thumb"
              alt="Thumbnail"
            />
            <div class="selected-info">
              <div class="selected-title">
                ${escapeHtml(this.selectedTargetVideo?.title || this.normalizedTargetId || '')}
              </div>
              <div class="selected-sub">
                Target ID: <span class="mono">${this.normalizedTargetId}</span>
              </div>
            </div>
          </div>
          <div style="font-size: 11px; color: #9ca3af; margin-bottom: 16px;">
            Updates will run sequentially in your browser session. You can stop the process at any time.
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: auto;">
            <button class="btn btn-secondary" id="btn-close-confirm">Cancel</button>
            <button class="btn btn-success" id="btn-start-bulk-confirmed">Start Assignment</button>
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // VIDEO PICKER MODAL OVERLAY
    // -------------------------------------------------------------
    let pickerModalHtml = '';
    if (this.isPickerOpen) {
      const searchResults = this.catalogStore.search(this.searchQuery, 50);
      const totalCatalogCount = this.catalogStore.count();

      const resultsItemsHtml =
        searchResults.length === 0
          ? `
          <div style="text-align: center; color: #71717a; padding: 24px 8px; font-size: 11px;">
            ${
              totalCatalogCount === 0
                ? 'No channel videos loaded yet.<br><button class="btn btn-secondary btn-sm" id="btn-retry-catalog" style="margin-top: 8px;">Refresh / Load Videos</button>'
                : `No videos matching "${escapeHtml(this.searchQuery)}"`
            }
          </div>`
          : searchResults
              .map(
                (v) => `
          <div class="video-item" data-video-id="${escapeHtml(v.id)}">
            <img
              src="${escapeHtml(v.thumbnailUrl || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`)}"
              class="video-item-thumb"
              alt="thumb"
            />
            <div class="video-item-info">
              <div class="video-item-title">${escapeHtml(v.title)}</div>
              <div class="video-item-meta">
                ${v.duration ? `<span>${escapeHtml(v.duration)}</span> &bull; ` : ''}
                <span class="mono">${escapeHtml(v.id)}</span>
              </div>
            </div>
          </div>
        `
              )
              .join('');

      pickerModalHtml = `
        <div class="modal-overlay">
          <div class="modal-header">
            <span class="modal-title">Select Related Video (${searchResults.length} / ${totalCatalogCount})</span>
            <button class="modal-close-btn" id="btn-close-picker">&times;</button>
          </div>
          <input
            type="text"
            class="search-input"
            id="picker-search-input"
            placeholder="🔍 Search videos by title or ID..."
            value="${escapeHtml(this.searchQuery)}"
          />
          <div class="video-results-list">
            ${resultsItemsHtml}
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // ADVANCED DIAGNOSTICS SECTION (Collapsible)
    // -------------------------------------------------------------
    let advancedHtml = '';
    if (this.showAdvanced) {
      advancedHtml = `
        <div class="card-box" style="margin-top: 10px; border-color: #52525b; background: #18181b;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; font-size: 11px; color: #a1a1aa;">Advanced Diagnostics</span>
            <span class="badge-pill ${this.isCaptureActive ? 'badge-green' : 'badge-amber'}">
              Capture: ${this.isCaptureActive ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm" id="toggle-capture-btn">
              ${this.isCaptureActive ? 'Stop Capture' : 'Start Capture'}
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-refresh-catalog-adv">
              Refresh Video Catalog
            </button>
          </div>
          <div style="font-size: 10px; color: #71717a; margin-top: 4px;">
            Captured Requests: ${this.capturedRequests.length} in memory &bull; Template: ${this.hasTemplate ? 'Active' : 'None'}
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
            <span class="pulse-dot"></span>
            <span class="main-title">ShortLinker &bull; Related Video</span>
          </div>
          <button class="minimize-btn" id="min-btn" title="Minimize">_</button>
        </div>

        <div class="scroll-body">
          ${onboardingHtml}
          ${workflowContent}
          ${advancedHtml}
        </div>

        <div class="footer-note">
          <button class="text-link" id="btn-toggle-advanced" style="font-size: 10px; color: #71717a;">
            ⚙ ${this.showAdvanced ? 'Hide Advanced' : 'Advanced'}
          </button>
          <span>Open Source</span>
        </div>
      </div>
    `;

    // -------------------------------------------------------------
    // EVENT BINDINGS
    // -------------------------------------------------------------
    this.shadowRoot.getElementById('min-btn')?.addEventListener('click', () => {
      this.toggleMinimize();
    });

    this.shadowRoot.getElementById('btn-dismiss-onboarding')?.addEventListener('click', () => {
      this.isOnboardingDismissed = true;
      this.render();
    });

    this.shadowRoot.getElementById('btn-toggle-advanced')?.addEventListener('click', () => {
      this.showAdvanced = !this.showAdvanced;
      this.render();
    });

    // Picker Open / Close
    this.shadowRoot.getElementById('btn-open-picker')?.addEventListener('click', () => {
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
      this.clearTargetVideo();
    });

    this.shadowRoot.getElementById('btn-toggle-manual')?.addEventListener('click', () => {
      this.isManualFallbackOpen = !this.isManualFallbackOpen;
      this.render();
    });

    this.shadowRoot.getElementById('btn-retry-catalog')?.addEventListener('click', () => {
      this.requestCatalogRefresh();
    });

    this.shadowRoot.getElementById('btn-refresh-catalog-adv')?.addEventListener('click', () => {
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

    // Single Short test bindings
    this.shadowRoot.getElementById('btn-single-test-confirm')?.addEventListener('click', () => {
      this.executeSingleShortTest();
    });

    // Bulk Confirmation Modal bindings
    this.shadowRoot.getElementById('btn-open-confirm-bulk')?.addEventListener('click', () => {
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

    // Advanced Diagnostics bindings
    this.shadowRoot.getElementById('toggle-capture-btn')?.addEventListener('click', () => {
      this.toggleCapture();
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
