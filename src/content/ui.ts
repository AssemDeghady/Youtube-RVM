import { StudioPageContext, CapturedRequest, RelatedVideoMutationMeta, ReplayResult, BRIDGE_EVENTS } from '../types';

export class DevIndicatorUI {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private currentContext: StudioPageContext | null = null;
  private navCount = 0;
  private isMinimized = false;
  private isCaptureActive = false;
  private capturedRequests: CapturedRequest[] = [];
  private activeMutation: RelatedVideoMutationMeta | null = null;
  private replayState: 'idle' | 'confirming' | 'replaying' | 'done' = 'idle';
  private replayResult: ReplayResult | null = null;
  private activeTab: 'studio' | 'inspector' = 'studio';

  public mount(initialContext: StudioPageContext): void {
    if (this.hostElement) return;

    this.currentContext = initialContext;
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'shortlinker-poc-root';
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    document.body.appendChild(this.hostElement);

    // Listen to sanitized capture events from MAIN world
    document.addEventListener(BRIDGE_EVENTS.CAPTURE, ((event: CustomEvent<CapturedRequest>) => {
      if (event.detail) {
        this.addCapturedRequest(event.detail);
      }
    }) as EventListener);

    // Listen to Related Video mutation detection events
    document.addEventListener(BRIDGE_EVENTS.MUTATION_DETECTED, ((event: CustomEvent<RelatedVideoMutationMeta>) => {
      if (event.detail) {
        this.activeMutation = event.detail;
        this.replayState = 'idle';
        this.replayResult = null;
        this.activeTab = 'inspector';
        this.render();
      }
    }) as EventListener);

    // Listen to Replay result events
    document.addEventListener(BRIDGE_EVENTS.REPLAY_RESPONSE, ((event: CustomEvent<ReplayResult>) => {
      if (event.detail) {
        this.replayResult = event.detail;
        this.replayState = 'done';
        this.render();
      }
    }) as EventListener);

    this.render();
  }

  public updateContext(context: StudioPageContext): void {
    this.currentContext = context;
    this.navCount++;
    this.render();
  }

  public addCapturedRequest(req: CapturedRequest): void {
    this.capturedRequests.unshift(req);
    if (this.capturedRequests.length > 50) {
      this.capturedRequests.pop();
    }
    if (this.isCaptureActive) {
      this.activeTab = 'inspector';
    }
    this.render();
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

  private clearCaptures(): void {
    this.capturedRequests = [];
    this.render();
  }

  private triggerReplay(): void {
    this.replayState = 'replaying';
    this.render();
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REPLAY_REQUEST));
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

    const readableType = this.currentContext.pageType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

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
      .badge-container {
        background: #18181b;
        color: #f4f4f5;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        box-shadow: 0 14px 30px -4px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        padding: 12px 14px;
        width: 400px;
        max-width: 90vw;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(8px);
        transition: all 0.2s ease-in-out;
      }
      .badge-container.minimized {
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
        background-color: ${this.isCaptureActive ? '#22c55e' : '#71717a'};
        box-shadow: ${this.isCaptureActive ? '0 0 0 2px rgba(34, 197, 94, 0.3)' : 'none'};
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
        max-height: 540px;
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
      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #a1a1aa;
      }
      .detail-val {
        color: #e4e4e7;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        background: #27272a;
        padding: 2px 6px;
        border-radius: 4px;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .highlight {
        color: #38bdf8;
      }
      .inspector-control-box {
        background: #27272a;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .control-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        background: ${this.isCaptureActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(113, 113, 122, 0.2)'};
        color: ${this.isCaptureActive ? '#4ade80' : '#a1a1aa'};
      }
      .action-btns {
        display: flex;
        gap: 6px;
      }
      .btn {
        border: none;
        padding: 4px 10px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .btn:hover:not(:disabled) {
        opacity: 0.9;
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-primary {
        background: ${this.isCaptureActive ? '#ef4444' : '#0284c7'};
        color: #ffffff;
      }
      .btn-replay {
        background: #2563eb;
        color: #ffffff;
        font-weight: 600;
      }
      .btn-cancel {
        background: #4b5563;
        color: #f3f4f6;
      }
      .btn-secondary {
        background: #3f3f46;
        color: #e4e4e7;
      }

      /* Mutation Box Styles */
      .mutation-box {
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 10px;
        background: #1c1c20;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .mutation-box.active {
        border-color: #059669;
        background: #06281e;
      }
      .mutation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .mutation-title {
        font-weight: 600;
        font-size: 12px;
        color: #fafafa;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge-captured {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
        font-weight: 600;
      }
      .badge-empty {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        background: rgba(113, 113, 122, 0.2);
        color: #a1a1aa;
      }
      .badge-exp {
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 3px;
        background: #d97706;
        color: #fff;
        font-weight: 600;
      }
      .mutation-fields {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
      }
      .field-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .field-label {
        color: #9ca3af;
      }
      .field-val {
        color: #f3f4f6;
      }
      .field-val.mono {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: #18181b;
        padding: 2px 5px;
        border-radius: 3px;
      }
      .confirm-box {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 5px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .confirm-text {
        font-size: 11px;
        color: #f3f4f6;
        line-height: 1.35;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .result-box {
        border-radius: 5px;
        padding: 8px;
        font-size: 11px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .result-box.success {
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid #059669;
        color: #34d399;
      }
      .result-box.failed {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid #dc2626;
        color: #f87171;
      }
      .result-header {
        font-weight: 700;
        display: flex;
        justify-content: space-between;
      }
      .card {
        background: #202023;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .method-tag {
        font-family: ui-monospace, monospace;
        font-weight: 700;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 3px;
        background: #0369a1;
        color: #f0f9ff;
      }
      .status-tag {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 600;
      }
      .status-2xx {
        background: rgba(34, 197, 94, 0.2);
        color: #4ade80;
      }
      .status-err {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
      }
      .card-path {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: #38bdf8;
        word-break: break-all;
      }
      .card-meta {
        font-size: 10px;
        color: #71717a;
        display: flex;
        justify-content: space-between;
      }
      .code-container {
        position: relative;
        margin-top: 4px;
      }
      .code-box {
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 4px;
        padding: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        color: #a1a1aa;
        max-height: 120px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-all;
        margin: 0;
      }
      .copy-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #27272a;
        border: 1px solid #3f3f46;
        color: #e4e4e7;
        font-size: 9px;
        padding: 2px 5px;
        border-radius: 3px;
        cursor: pointer;
      }
      .copy-btn:hover {
        background: #3f3f46;
      }
      .empty-state {
        text-align: center;
        padding: 14px 8px;
        color: #71717a;
        font-size: 11px;
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
        <div class="badge-container minimized" id="expand-trigger">
          <div class="title-group">
            <span class="pulse-dot"></span>
            <span class="main-title">ShortLinker POC ${this.activeMutation ? '(Mutation Ready)' : ''}</span>
          </div>
        </div>
      `;
      this.shadowRoot.getElementById('expand-trigger')?.addEventListener('click', () => {
        this.toggleMinimize();
      });
      return;
    }

    const studioTabContent = `
      <div class="detail-row">
        <span>Page View:</span>
        <span class="detail-val highlight">${readableType}</span>
      </div>
      ${
        this.currentContext.videoId
          ? `
      <div class="detail-row">
        <span>Video ID:</span>
        <span class="detail-val">${this.currentContext.videoId}</span>
      </div>`
          : ''
      }
      ${
        this.currentContext.channelId
          ? `
      <div class="detail-row">
        <span>Channel ID:</span>
        <span class="detail-val">${this.currentContext.channelId}</span>
      </div>`
          : ''
      }
      <div class="detail-row">
        <span>SPA Navigations:</span>
        <span class="detail-val">${this.navCount}</span>
      </div>
      <div class="detail-row">
        <span>Mutation Captured:</span>
        <span class="detail-val ${this.activeMutation ? 'highlight' : ''}">${this.activeMutation ? 'Yes (Ready)' : 'None'}</span>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: #a1a1aa; line-height: 1.4;">
        Switch to the <b>Network Inspector</b> tab to observe or test replaying the Related Video mutation.
      </div>
    `;

    // Render Mutation Section
    let mutationSectionHtml = '';
    if (!this.activeMutation) {
      mutationSectionHtml = `
        <div class="mutation-box">
          <div class="mutation-header">
            <span class="mutation-title">Related Video Mutation</span>
            <span class="badge-empty">None captured</span>
          </div>
          <div style="font-size: 11px; color: #71717a;">
            No Related Video mutation captured yet.<br>
            Change and save a Related Video on any Short to capture.
          </div>
        </div>
      `;
    } else {
      let replayControlsHtml = '';
      if (this.replayState === 'idle') {
        replayControlsHtml = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <span class="badge-exp">Experimental</span>
            <button class="btn btn-replay" id="btn-show-confirm">Test Replay</button>
          </div>
        `;
      } else if (this.replayState === 'confirming') {
        replayControlsHtml = `
          <div class="confirm-box">
            <div class="confirm-text">
              This will replay the last captured Related Video update for the same Short and Related Video. Continue?
            </div>
            <div class="confirm-actions">
              <button class="btn btn-cancel" id="btn-cancel-confirm">Cancel</button>
              <button class="btn btn-replay" id="btn-exec-replay">Replay</button>
            </div>
          </div>
        `;
      } else if (this.replayState === 'replaying') {
        replayControlsHtml = `
          <div style="display: flex; justify-content: center; align-items: center; padding: 6px; color: #60a5fa; font-size: 11px; gap: 6px;">
            <span class="pulse-dot"></span>
            Replaying mutation in browser session...
          </div>
        `;
      } else if (this.replayState === 'done' && this.replayResult) {
        const isSuccess = this.replayResult.success;
        replayControlsHtml = `
          <div class="result-box ${isSuccess ? 'success' : 'failed'}">
            <div class="result-header">
              <span>Replay Result</span>
              <span>${isSuccess ? 'Success — HTTP 200' : `Failed — HTTP ${this.replayResult.httpStatus || 'ERR'}`}</span>
            </div>
            <div>
              ${
                isSuccess
                  ? `Verified: Short [${this.replayResult.sourceVideoId}] linked to [${this.replayResult.targetVideoId}] (${this.replayResult.durationMs}ms)`
                  : `Status: ${this.replayResult.statusText} ${
                      this.replayResult.attestationRejected ? '<br><b>Notice:</b> Attestation or challenge rejected.' : ''
                    }`
              }
            </div>
            <div class="code-container" style="margin-top: 4px;">
              <pre class="code-box">${escapeHtml(this.replayResult.sanitizedResponseSnippet)}</pre>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
              <button class="btn btn-secondary" id="btn-dismiss-replay">Dismiss</button>
              <button class="btn btn-replay" id="btn-show-confirm">Test Replay Again</button>
            </div>
          </div>
        `;
      }

      mutationSectionHtml = `
        <div class="mutation-box active">
          <div class="mutation-header">
            <span class="mutation-title">Related Video Mutation</span>
            <span class="badge-captured">Captured (HTTP ${this.activeMutation.httpStatus ?? 200})</span>
          </div>
          <div class="mutation-fields">
            <div class="field-row">
              <span class="field-label">Source Short:</span>
              <span class="field-val mono">${this.activeMutation.sourceVideoId}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Related Video:</span>
              <span class="field-val mono highlight">${this.activeMutation.targetVideoId}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Time:</span>
              <span class="field-val">${this.activeMutation.timestamp}</span>
            </div>
          </div>
          ${replayControlsHtml}
        </div>
      `;
    }

    const cardsHtml =
      this.capturedRequests.length === 0
        ? `<div class="empty-state">${
            this.isCaptureActive
              ? 'Listening for YouTube Studio metadata requests...<br>Save a Related Video in Studio to capture.'
              : 'Capture is currently OFF.<br>Click "Start Capture" to record candidate requests.'
          }</div>`
        : this.capturedRequests
            .map((req, idx) => {
              const statusClass =
                req.status && req.status >= 200 && req.status < 300 ? 'status-2xx' : 'status-err';
              const bodyStr =
                req.bodyType === 'json'
                  ? JSON.stringify(req.sanitizedBody, null, 2)
                  : typeof req.sanitizedBody === 'string'
                  ? req.sanitizedBody
                  : JSON.stringify(req.sanitizedBody);

              return `
          <div class="card">
            <div class="card-header">
              <div style="display: flex; gap: 6px; align-items: center;">
                <span class="method-tag">${req.method}</span>
                <span class="card-path" title="${req.url}">${req.pathname}</span>
              </div>
              <span class="status-tag ${statusClass}">${req.status ?? 'Pending'}</span>
            </div>
            <div class="card-meta">
              <span>${req.timestamp} (${req.durationMs ?? 0}ms &bull; ${req.source.toUpperCase()})</span>
              <span>Type: ${req.contentType.split(';')[0] || 'unspecified'}</span>
            </div>
            <div class="code-container">
              <button class="copy-btn" data-copy-idx="${idx}">Copy JSON</button>
              <pre class="code-box">${escapeHtml(bodyStr)}</pre>
            </div>
          </div>
        `;
            })
            .join('');

    const inspectorTabContent = `
      <div class="inspector-control-box">
        <div class="control-row">
          <div class="status-pill">
            <span class="pulse-dot"></span>
            Status: ${this.isCaptureActive ? 'ON' : 'OFF'}
          </div>
          <div class="action-btns">
            <button class="btn btn-primary" id="toggle-capture-btn">
              ${this.isCaptureActive ? 'Stop Capture' : 'Start Capture'}
            </button>
            <button class="btn btn-secondary" id="clear-captures-btn" ${
              this.capturedRequests.length === 0 ? 'disabled' : ''
            }>
              Clear
            </button>
          </div>
        </div>
        <div class="detail-row" style="font-size: 11px;">
          <span>Captured Candidates:</span>
          <span style="font-weight: 600; color: #f4f4f5;">${this.capturedRequests.length}</span>
        </div>
      </div>

      ${mutationSectionHtml}

      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${cardsHtml}
      </div>
    `;

    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="badge-container">
        <div class="header-row">
          <div class="title-group">
            <span class="pulse-dot"></span>
            <span class="main-title">ShortLinker POC — YouTube Studio</span>
          </div>
          <button class="minimize-btn" id="min-btn" title="Minimize indicator">_</button>
        </div>

        <div class="tab-bar">
          <button class="tab-btn ${this.activeTab === 'studio' ? 'active' : ''}" id="tab-studio">Studio Context</button>
          <button class="tab-btn ${this.activeTab === 'inspector' ? 'active' : ''}" id="tab-inspector">
            Network Inspector ${this.capturedRequests.length > 0 ? `(${this.capturedRequests.length})` : ''}
          </button>
        </div>

        <div class="tab-content">
          ${this.activeTab === 'studio' ? studioTabContent : inspectorTabContent}
        </div>

        <div class="footer-note">
          <span>In-memory only &bull; Credentials Redacted</span>
          <span>Read-only POC</span>
        </div>
      </div>
    `;

    // Event Bindings
    this.shadowRoot.getElementById('min-btn')?.addEventListener('click', () => {
      this.toggleMinimize();
    });

    this.shadowRoot.getElementById('tab-studio')?.addEventListener('click', () => {
      this.activeTab = 'studio';
      this.render();
    });

    this.shadowRoot.getElementById('tab-inspector')?.addEventListener('click', () => {
      this.activeTab = 'inspector';
      this.render();
    });

    this.shadowRoot.getElementById('toggle-capture-btn')?.addEventListener('click', () => {
      this.toggleCapture();
    });

    this.shadowRoot.getElementById('clear-captures-btn')?.addEventListener('click', () => {
      this.clearCaptures();
    });

    // Replay controls bindings
    this.shadowRoot.getElementById('btn-show-confirm')?.addEventListener('click', () => {
      this.replayState = 'confirming';
      this.render();
    });

    this.shadowRoot.getElementById('btn-cancel-confirm')?.addEventListener('click', () => {
      this.replayState = 'idle';
      this.render();
    });

    this.shadowRoot.getElementById('btn-exec-replay')?.addEventListener('click', () => {
      this.triggerReplay();
    });

    this.shadowRoot.getElementById('btn-dismiss-replay')?.addEventListener('click', () => {
      this.replayState = 'idle';
      this.replayResult = null;
      this.render();
    });

    // Copy buttons
    this.shadowRoot.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-copy-idx'));
        const targetReq = this.capturedRequests[idx];
        if (targetReq) {
          const exportData = {
            method: targetReq.method,
            url: targetReq.url,
            pathname: targetReq.pathname,
            contentType: targetReq.contentType,
            status: targetReq.status,
            safeHeaders: targetReq.safeHeaders,
            sanitizedBody: targetReq.sanitizedBody
          };
          this.copyToClipboard(JSON.stringify(exportData, null, 2), btn);
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
