import { StudioPageContext, CapturedRequest, BRIDGE_EVENTS } from '../types';

export class DevIndicatorUI {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private currentContext: StudioPageContext | null = null;
  private navCount = 0;
  private isMinimized = false;
  private isCaptureActive = false;
  private capturedRequests: CapturedRequest[] = [];
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

    this.render();
  }

  public updateContext(context: StudioPageContext): void {
    this.currentContext = context;
    this.navCount++;
    this.render();
  }

  public addCapturedRequest(req: CapturedRequest): void {
    // Keep in-memory only (max 50 to avoid memory buildup)
    this.capturedRequests.unshift(req);
    if (this.capturedRequests.length > 50) {
      this.capturedRequests.pop();
    }
    // Automatically switch to inspector tab if new request arrives while capturing
    if (this.isCaptureActive) {
      this.activeTab = 'inspector';
    }
    this.render();
  }

  private toggleCapture(): void {
    this.isCaptureActive = !this.isCaptureActive;
    // Dispatch control event to MAIN world
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
        width: 380px;
        max-width: 90vw;
        max-height: 80vh;
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
        max-height: 480px;
        display: flex;
        flex-direction: column;
        gap: 8px;
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
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
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
        padding: 3px 8px;
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
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .btn:hover {
        opacity: 0.9;
      }
      .btn-primary {
        background: ${this.isCaptureActive ? '#ef4444' : '#0284c7'};
        color: #ffffff;
      }
      .btn-secondary {
        background: #3f3f46;
        color: #e4e4e7;
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
        max-height: 140px;
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
        padding: 18px 8px;
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
            <span class="main-title">ShortLinker POC ${this.isCaptureActive ? '(Capturing)' : ''}</span>
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
        <span>Network Inspector:</span>
        <span class="detail-val ${this.isCaptureActive ? 'highlight' : ''}">${this.isCaptureActive ? 'Capturing' : 'Standby'}</span>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: #a1a1aa; line-height: 1.4;">
        Switch to the <b>Network Inspector</b> tab to start passive capture before editing a Related Video.
      </div>
    `;

    const cardsHtml =
      this.capturedRequests.length === 0
        ? `<div class="empty-state">${
            this.isCaptureActive
              ? 'Listening for YouTube Studio metadata requests...<br>Perform a Related Video save in Studio to capture.'
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
