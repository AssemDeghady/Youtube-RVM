import {
  StudioPageContext,
  CapturedRequest,
  RelatedVideoMutationMeta,
  ReplayResult,
  MutationItemProgress,
  MutationJobSummary,
  MutationExecutePayload,
  TargetVideo,
  BRIDGE_EVENTS
} from '../types';
import { normalizeYouTubeVideoId } from '../common/youtube';
import { VideoCatalogStore } from '../common/video-catalog';
import { isShortsListView } from './detector';

export class DevIndicatorUI {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private currentContext: StudioPageContext | null = null;
  private navCount = 0;
  private isMinimized = false;

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
  private currentJobId: string | null = null;

  // Active tab: 'shorts' (default on Shorts list), 'inspector', 'studio'
  private activeTab: 'shorts' | 'inspector' | 'studio' = 'shorts';

  public mount(initialContext: StudioPageContext): void {
    if (this.hostElement) return;

    this.currentContext = initialContext;
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'shortlinker-poc-root';
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    document.body.appendChild(this.hostElement);

    if (isShortsListView()) {
      this.activeTab = 'shorts';
    } else {
      this.activeTab = 'inspector';
    }

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
        this.render();
      }
    }) as EventListener);

    this.render();
  }

  public updateContext(context: StudioPageContext): void {
    this.currentContext = context;
    this.navCount++;
    if (isShortsListView() && this.activeTab === 'studio') {
      this.activeTab = 'shorts';
    }
    // Refresh DOM video catalog on route change
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
        title: `Manual Video (${res.videoId})`,
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

  private executeBulkAssignment(): void {
    if (!this.normalizedTargetId || this.selectedShortIds.length === 0) return;

    this.bulkJobState = 'running';
    this.bulkSummary = null;
    this.bulkItemsProgress.clear();
    this.currentJobId = `bulk_${Date.now()}`;

    for (const id of this.selectedShortIds) {
      this.bulkItemsProgress.set(id, {
        sourceShortId: id,
        targetVideoId: this.normalizedTargetId,
        status: 'queued'
      });
    }
    this.render();

    const payload: MutationExecutePayload = {
      jobId: this.currentJobId,
      sourceShortIds: this.selectedShortIds,
      targetVideoId: this.normalizedTargetId,
      delayMs: 800
    };

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.EXECUTE_MUTATION, { detail: payload }));
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
        bottom: 18px;
        right: 18px;
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
        border-radius: 10px;
        box-shadow: 0 14px 30px -4px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        padding: 12px 14px;
        width: 420px;
        max-width: 92vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(8px);
        transition: all 0.2s ease-in-out;
      }
      .panel-container.minimized {
        width: auto;
        padding: 6px 12px;
        border-radius: 20px;
        cursor: pointer;
        display: block;
      }
      .header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
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
        font-size: 11px;
        border-radius: 4px;
      }
      .minimize-btn:hover {
        background: #27272a;
        color: #fafafa;
      }
      .tab-bar {
        display: flex;
        border-bottom: 1px solid #27272a;
        margin-bottom: 10px;
      }
      .tab-btn {
        flex: 1;
        padding: 6px 0;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: #a1a1aa;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .tab-btn.active {
        color: #38bdf8;
        border-bottom-color: #38bdf8;
      }
      .tab-btn:hover:not(.active) {
        color: #e4e4e7;
      }
      .tab-content {
        overflow-y: auto;
        max-height: 560px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-right: 4px;
      }
      .tab-content::-webkit-scrollbar {
        width: 4px;
      }
      .tab-content::-webkit-scrollbar-thumb {
        background: #3f3f46;
        border-radius: 4px;
      }

      /* Card boxes */
      .card-box {
        background: #202023;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .card-box.highlight {
        border-color: #0284c7;
      }

      /* Video Picker Display */
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
        width: 64px;
        height: 36px;
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
        font-size: 10px;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
      }
      .text-link:hover {
        color: #7dd3fc;
      }

      /* Modal Popover */
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(6px);
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        padding: 12px;
        z-index: 100;
        box-shadow: inset 0 0 0 1px #3f3f46;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
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
        font-size: 16px;
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
        padding: 6px 12px;
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
        padding: 3px 8px;
        font-size: 10px;
      }

      /* Form input */
      .input-text {
        background: #09090b;
        border: 1px solid #3f3f46;
        color: #f4f4f5;
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 11px;
        font-family: inherit;
        outline: none;
      }
      .input-text:focus {
        border-color: #0284c7;
      }

      /* Progress table */
      .progress-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 180px;
        overflow-y: auto;
        border: 1px solid #27272a;
        border-radius: 4px;
        padding: 6px;
        background: #09090b;
      }
      .progress-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        padding: 2px 4px;
        border-radius: 3px;
      }
      .progress-row.success {
        color: #4ade80;
      }
      .progress-row.failed {
        color: #f87171;
      }
      .progress-row.running {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.1);
      }
      .progress-row.queued {
        color: #71717a;
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
        max-height: 110px;
        overflow-y: auto;
        white-space: pre-wrap;
        margin: 0;
      }
      .footer-note {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid #27272a;
        font-size: 10px;
        color: #71717a;
        display: flex;
        justify-content: space-between;
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
    // SHORTS LIST VIEW TAB CONTENT
    // -------------------------------------------------------------
    let shortsTabContent = '';

    if (!onShortsList) {
      shortsTabContent = `
        <div class="card-box" style="text-align: center; padding: 18px 10px;">
          <div style="font-weight: 600; font-size: 12px; color: #f4f4f5; margin-bottom: 4px;">
            Shorts List View Standby
          </div>
          <div style="font-size: 11px; color: #a1a1aa; line-height: 1.4;">
            Navigate to <b>Content &rarr; Shorts</b> in YouTube Studio to use bulk selection and link Related Videos directly from the list.
          </div>
        </div>
      `;
    } else {
      const templateNoticeHtml = !this.hasTemplate
        ? `
        <div class="card-box" style="border-color: #d97706; background: rgba(217, 119, 6, 0.1);">
          <div style="font-weight: 600; color: #fbbf24; font-size: 11px;">
            Session Template Required
          </div>
          <div style="font-size: 10px; color: #d1d5db; line-height: 1.35;">
            To link videos through your session, YouTube requires an active mutation template.
            Please save any Related Video manually once in Studio this session to capture it.
          </div>
        </div>`
        : '';

      // Target Related Video Selection UI
      let targetSelectorHtml = '';
      if (this.selectedTargetVideo) {
        targetSelectorHtml = `
          <div class="card-box">
            <div style="font-size: 11px; font-weight: 600; color: #a1a1aa; display: flex; justify-content: space-between;">
              <span>Selected Related Video:</span>
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
            <button class="btn btn-primary" id="btn-open-picker" style="width: 100%; padding: 8px 12px;">
              🔍 Select a video
            </button>
            <div style="font-size: 10px; color: #71717a; text-align: center;">
              Choose the video that should be linked to the selected Shorts.
            </div>
            <div style="text-align: center; margin-top: 2px;">
              <button class="text-link" id="btn-toggle-manual">
                ${this.isManualFallbackOpen ? "Hide manual entry" : "Can't find your video? Enter URL or ID"}
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
                  placeholder="Paste YouTube watch URL, Shorts URL, or ID"
                  value="${escapeHtml(this.manualInputVal)}"
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
                ? 'Select Shorts using the row checkboxes in YouTube Studio.'
                : selectedCount === 1
                ? `1 Short selected (${this.selectedShortIds[0]}). Ready for test.`
                : `${selectedCount} Shorts selected from list.`
            }
          </div>
        </div>
      `;

      // Execution Section: Single Short vs Multi-Short
      let executionSectionHtml = '';

      if (selectedCount === 0) {
        executionSectionHtml = `
          <div style="text-align: center; color: #71717a; font-size: 11px; padding: 10px 0;">
            Check one or more rows in YouTube's table to enable actions.
          </div>
        `;
      } else if (selectedCount === 1) {
        // EXACT SINGLE SHORT TEST PATH
        const singleShortId = this.selectedShortIds[0];

        if (this.singleTestState === 'idle') {
          executionSectionHtml = `
            <div class="card-box highlight">
              <div style="font-weight: 600; font-size: 11px; color: #38bdf8;">
                Test One Selected Short
              </div>
              <div style="font-size: 11px; color: #d1d5db;">
                Target Short: <span class="mono">${singleShortId}</span>
              </div>
              <button
                class="btn btn-primary"
                id="btn-single-test-confirm"
                ${!this.normalizedTargetId || !this.hasTemplate ? 'disabled' : ''}
              >
                Test Update on this Short
              </button>
            </div>
          `;
        } else if (this.singleTestState === 'confirming') {
          executionSectionHtml = `
            <div class="card-box" style="border-color: #f59e0b; background: rgba(245, 158, 11, 0.08);">
              <div style="font-weight: 600; font-size: 11px; color: #fbbf24;">
                Confirm Single Test
              </div>
              <div style="font-size: 11px; color: #f3f4f6; line-height: 1.4;">
                You are about to change:<br>
                Short: <span class="mono">${singleShortId}</span><br>
                Related Video: <span class="mono highlight">${this.selectedTargetVideo?.title || this.normalizedTargetId}</span>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                <button class="btn btn-secondary" id="btn-single-cancel">Cancel</button>
                <button class="btn btn-success" id="btn-single-execute">Test Update</button>
              </div>
            </div>
          `;
        } else if (this.singleTestState === 'running') {
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
                  ${isSuccess ? 'Success — HTTP 200' : `Failed — HTTP ${this.singleTestResult.httpStatus || 'ERR'}`}
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
              ${
                this.singleTestResult.attestationRejected
                  ? `<div style="font-size: 10px; color: #fbbf24;"><b>Notice:</b> Attestation rejected by YouTube Studio.</div>`
                  : ''
              }
              <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                <button class="btn btn-secondary" id="btn-single-test-confirm">Run Again</button>
              </div>
            </div>
          `;
        }
      } else {
        // MULTI-SHORT BULK PATH
        const isGated = !this.hasSingleTestSucceeded && !this.isGateBypassed;

        if (this.bulkJobState === 'idle') {
          if (isGated) {
            executionSectionHtml = `
              <div class="card-box" style="border-color: #d97706; background: rgba(217, 119, 6, 0.08);">
                <div style="font-weight: 600; color: #fbbf24; font-size: 11px;">
                  Safety Gate: Single Short Verification
                </div>
                <div style="font-size: 11px; color: #d1d5db; line-height: 1.35;">
                  Please select <b>1 Short</b> and run a single test first to verify session attestation, before running multi-video updates.
                </div>
                <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                  <button class="btn btn-secondary" id="btn-bypass-gate" style="font-size: 10px;">
                    Proceed with Bulk Anyway
                  </button>
                </div>
              </div>
            `;
          } else {
            executionSectionHtml = `
              <div class="card-box highlight">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-weight: 600; font-size: 12px; color: #f4f4f5;">Bulk Assignment</span>
                  <span class="badge-pill badge-green">Ready</span>
                </div>
                <div style="font-size: 11px; color: #a1a1aa;">
                  Assign <span class="mono highlight">${this.selectedTargetVideo?.title || this.normalizedTargetId || '...'}</span> to all <b>${selectedCount}</b> selected Shorts sequentially.
                </div>
                <button
                  class="btn btn-primary"
                  id="btn-start-bulk"
                  ${!this.normalizedTargetId || !this.hasTemplate ? 'disabled' : ''}
                >
                  Assign to ${selectedCount} Shorts
                </button>
              </div>
            `;
          }
        } else if (this.bulkJobState === 'running') {
          const completedCount = Array.from(this.bulkItemsProgress.values()).filter(
            (it) => it.status === 'success' || it.status === 'failed' || it.status === 'cancelled'
          ).length;

          const progressRowsHtml = Array.from(this.bulkItemsProgress.values())
            .map((it) => {
              const icon =
                it.status === 'success'
                  ? '✓'
                  : it.status === 'failed'
                  ? '✗'
                  : it.status === 'running'
                  ? '⟳'
                  : '○';
              return `
              <div class="progress-row ${it.status}">
                <span>${icon} <span class="mono">${it.sourceShortId}</span></span>
                <span>${it.status.toUpperCase()} ${it.httpStatus ? `(${it.httpStatus})` : ''}</span>
              </div>
            `;
            })
            .join('');

          executionSectionHtml = `
            <div class="card-box">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; font-size: 11px; color: #38bdf8;">
                  Processing: ${completedCount} / ${selectedCount}
                </span>
                <button class="btn btn-danger" id="btn-cancel-bulk" style="padding: 2px 8px; font-size: 10px;">
                  Stop / Cancel
                </button>
              </div>
              <div class="progress-list">
                ${progressRowsHtml}
              </div>
            </div>
          `;
        } else if (this.bulkJobState === 'done' || this.bulkJobState === 'cancelled') {
          const summary = this.bulkSummary;
          const progressRowsHtml = Array.from(this.bulkItemsProgress.values())
            .map((it) => {
              const icon =
                it.status === 'success'
                  ? '✓'
                  : it.status === 'failed'
                  ? '✗'
                  : '○';
              return `
              <div class="progress-row ${it.status}">
                <span>${icon} <span class="mono">${it.sourceShortId}</span></span>
                <span>${it.status.toUpperCase()} ${it.error ? `- ${escapeHtml(it.error)}` : ''}</span>
              </div>
            `;
            })
            .join('');

          executionSectionHtml = `
            <div class="card-box" style="border-color: ${
              summary && summary.failed === 0 ? '#059669' : '#f59e0b'
            };">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; font-size: 12px; color: #f4f4f5;">
                  ${this.bulkJobState === 'cancelled' ? 'Operation Cancelled' : 'Bulk Update Complete'}
                </span>
                <span class="badge-pill ${summary && summary.failed === 0 ? 'badge-green' : 'badge-amber'}">
                  ${summary ? `${summary.succeeded} / ${summary.total} Succeeded` : ''}
                </span>
              </div>
              <div class="progress-list">
                ${progressRowsHtml}
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                <button class="btn btn-secondary" id="btn-reset-bulk">Close Summary</button>
              </div>
            </div>
          `;
        }
      }

      shortsTabContent = `
        ${templateNoticeHtml}
        ${targetSelectorHtml}
        ${selectionBarHtml}
        ${executionSectionHtml}
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
                ? 'No videos loaded yet from YouTube Studio.<br><button class="btn btn-secondary btn-sm" id="btn-retry-catalog" style="margin-top: 8px;">Refresh / Load Videos</button>'
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
                ${v.videoType ? `<span>${escapeHtml(v.videoType.toUpperCase())}</span> &bull; ` : ''}
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
            placeholder="🔍 Search by title or video ID..."
            value="${escapeHtml(this.searchQuery)}"
          />
          <div class="video-results-list">
            ${resultsItemsHtml}
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // NETWORK INSPECTOR TAB CONTENT
    // -------------------------------------------------------------
    const inspectorTabContent = `
      <div class="card-box" style="padding: 8px 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="badge-pill ${this.isCaptureActive ? 'badge-green' : 'badge-amber'}">
            Capture: ${this.isCaptureActive ? 'ON' : 'OFF'}
          </span>
          <button class="btn btn-primary" id="toggle-capture-btn" style="padding: 3px 8px; font-size: 10px;">
            ${this.isCaptureActive ? 'Stop Capture' : 'Start Capture'}
          </button>
        </div>
      </div>
      <div style="font-size: 11px; color: #a1a1aa;">
        ${this.capturedRequests.length} candidate request(s) captured in memory.
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${
          this.capturedRequests.length === 0
            ? '<div style="text-align: center; color: #71717a; font-size: 11px; padding: 12px 0;">No candidate requests captured yet.</div>'
            : this.capturedRequests
                .map(
                  (req, idx) => `
          <div class="card-box" style="padding: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px;">
              <span class="mono" style="color: #38bdf8;">[${req.method}] ${req.pathname}</span>
              <span class="badge-pill badge-green">${req.status ?? '200'}</span>
            </div>
            <pre class="code-box">${escapeHtml(
              typeof req.sanitizedBody === 'object'
                ? JSON.stringify(req.sanitizedBody, null, 2)
                : String(req.sanitizedBody)
            )}</pre>
            <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
              <button class="btn btn-secondary copy-btn" data-copy-idx="${idx}" style="font-size: 9px; padding: 2px 6px;">
                Copy JSON
              </button>
            </div>
          </div>
        `
                )
                .join('')
        }
      </div>
    `;

    // -------------------------------------------------------------
    // STUDIO CONTEXT CONTENT
    // -------------------------------------------------------------
    const readableType = this.currentContext.pageType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const studioTabContent = `
      <div class="card-box">
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Page View:</span>
          <span class="mono" style="color: #38bdf8;">${readableType}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Shorts List Detected:</span>
          <span class="badge-pill ${onShortsList ? 'badge-green' : 'badge-amber'}">${onShortsList ? 'Yes' : 'No'}</span>
        </div>
        ${
          this.currentContext.channelId
            ? `<div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Channel ID:</span>
          <span class="mono">${this.currentContext.channelId}</span>
        </div>`
            : ''
        }
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Catalog Videos in Memory:</span>
          <span class="badge-pill badge-green">${this.catalogStore.count()}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Template in Memory:</span>
          <span class="badge-pill ${this.hasTemplate ? 'badge-green' : 'badge-amber'}">${this.hasTemplate ? 'Active' : 'None'}</span>
        </div>
      </div>
    `;

    // Full Render
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="panel-container">
        ${pickerModalHtml}

        <div class="header-row">
          <div class="title-group">
            <span class="pulse-dot"></span>
            <span class="main-title">ShortLinker &bull; Shorts Manager</span>
          </div>
          <button class="minimize-btn" id="min-btn" title="Minimize indicator">_</button>
        </div>

        <div class="tab-bar">
          <button class="tab-btn ${this.activeTab === 'shorts' ? 'active' : ''}" id="tab-shorts">
            Shorts Linker ${selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
          <button class="tab-btn ${this.activeTab === 'inspector' ? 'active' : ''}" id="tab-inspector">
            Network Inspector
          </button>
          <button class="tab-btn ${this.activeTab === 'studio' ? 'active' : ''}" id="tab-studio">
            Context
          </button>
        </div>

        <div class="tab-content">
          ${
            this.activeTab === 'shorts'
              ? shortsTabContent
              : this.activeTab === 'inspector'
              ? inspectorTabContent
              : studioTabContent
          }
        </div>

        <div class="footer-note">
          <span>Local session &bull; Zero credentials stored</span>
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

    this.shadowRoot.getElementById('tab-shorts')?.addEventListener('click', () => {
      this.activeTab = 'shorts';
      this.render();
    });

    this.shadowRoot.getElementById('tab-inspector')?.addEventListener('click', () => {
      this.activeTab = 'inspector';
      this.render();
    });

    this.shadowRoot.getElementById('tab-studio')?.addEventListener('click', () => {
      this.activeTab = 'studio';
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
      // Auto-focus search input
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

    // Search input binding
    const searchInputEl = this.shadowRoot.getElementById('picker-search-input') as HTMLInputElement | null;
    searchInputEl?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.render();
      // Keep focus after re-render
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
      this.singleTestState = 'confirming';
      this.render();
    });

    this.shadowRoot.getElementById('btn-single-cancel')?.addEventListener('click', () => {
      this.singleTestState = 'idle';
      this.render();
    });

    this.shadowRoot.getElementById('btn-single-execute')?.addEventListener('click', () => {
      this.executeSingleShortTest();
    });

    // Bulk execution bindings
    this.shadowRoot.getElementById('btn-bypass-gate')?.addEventListener('click', () => {
      this.isGateBypassed = true;
      this.render();
    });

    this.shadowRoot.getElementById('btn-start-bulk')?.addEventListener('click', () => {
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

    // Inspector bindings
    this.shadowRoot.getElementById('toggle-capture-btn')?.addEventListener('click', () => {
      this.toggleCapture();
    });

    this.shadowRoot.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-copy-idx'));
        const targetReq = this.capturedRequests[idx];
        if (targetReq) {
          this.copyToClipboard(JSON.stringify(targetReq, null, 2), btn);
        }
      });
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
