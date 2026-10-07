import { filterSafeHeaders, parseAndSanitizeBody } from '../common/sanitizer';
import { isCandidateRequest } from '../common/filter';
import { BRIDGE_EVENTS, CapturedRequest } from '../types';

declare global {
  interface Window {
    SHORTLINKER_NETWORK_INSPECTOR_INSTALLED?: boolean;
    SHORTLINKER_INSPECTOR_ACTIVE?: boolean;
  }
}

// 1. Guard against duplicate injection across SPA navigation or scripts
if (window.SHORTLINKER_NETWORK_INSPECTOR_INSTALLED) {
  console.info('[ShortLinker Interceptor] Already installed in MAIN world, skipping.');
} else {
  window.SHORTLINKER_NETWORK_INSPECTOR_INSTALLED = true;
  window.SHORTLINKER_INSPECTOR_ACTIVE = false; // Default: OFF

  console.info(
    '%c[ShortLinker Interceptor] Passive network listener installed in MAIN world (Status: OFF).',
    'background: #1e293b; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
  );

  // Listen for control commands from Isolated World UI
  document.addEventListener(BRIDGE_EVENTS.CONTROL, ((event: CustomEvent<{ enabled: boolean }>) => {
    if (event.detail && typeof event.detail.enabled === 'boolean') {
      window.SHORTLINKER_INSPECTOR_ACTIVE = event.detail.enabled;
      console.info(
        `%c[ShortLinker Interceptor] Capture status changed: ${window.SHORTLINKER_INSPECTOR_ACTIVE ? 'ON' : 'OFF'}`,
        `font-weight: bold; color: ${window.SHORTLINKER_INSPECTOR_ACTIVE ? '#22c55e' : '#f97316'};`
      );
    }
  }) as EventListener);

  function broadcastCapture(captured: CapturedRequest) {
    // Dispatch sanitized event to isolated-world content script UI
    const customEvent = new CustomEvent(BRIDGE_EVENTS.CAPTURE, {
      detail: captured
    });
    document.dispatchEvent(customEvent);

    // Also log to console for instant developer feedback
    const style = 'background: #0f172a; color: #a855f7; font-weight: bold; padding: 2px 6px; border-radius: 4px;';
    console.groupCollapsed(`%c[ShortLinker Interceptor] Candidate Captured: [${captured.method}] ${captured.pathname}`, style);
    console.log('%cURL:', 'font-weight: bold;', captured.url);
    console.log('%cStatus:', 'font-weight: bold;', captured.status, captured.statusText);
    console.log('%cSafe Headers:', 'font-weight: bold;', captured.safeHeaders);
    console.log('%cSanitized Request Body (%s):', 'font-weight: bold;', captured.bodyType, captured.sanitizedBody);
    console.groupEnd();
  }

  // ==========================================
  // 2. Passive window.fetch Interception
  // ==========================================
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startTime = performance.now();
    let urlStr = '';
    let method = 'GET';
    let rawBody: any = null;
    let contentType = '';
    let reqHeaders: any = null;

    try {
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        urlStr = input.url;
        method = input.method;
        reqHeaders = input.headers;
        contentType = input.headers.get('content-type') || '';
        // Safely read body by cloning the Request without consuming the original
        if (input.body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
          try {
            const clone = input.clone();
            rawBody = await clone.text();
          } catch {
            rawBody = '[Could not clone Request body]';
          }
        }
      }

      if (init) {
        if (init.method) method = init.method;
        if (init.body !== undefined && init.body !== null) rawBody = init.body;
        if (init.headers) {
          reqHeaders = init.headers;
          if (init.headers instanceof Headers) {
            contentType = init.headers.get('content-type') || contentType;
          } else if (Array.isArray(init.headers)) {
            const found = init.headers.find(([k]) => k.toLowerCase() === 'content-type');
            if (found) contentType = found[1];
          } else if (typeof init.headers === 'object') {
            for (const [k, v] of Object.entries(init.headers)) {
              if (k.toLowerCase() === 'content-type') contentType = String(v);
            }
          }
        }
      }
    } catch (parseErr) {
      console.warn('[ShortLinker Interceptor] Error parsing fetch arguments:', parseErr);
    }

    // Call originalFetch UNMODIFIED
    let response: Response;
    try {
      response = await originalFetch.apply(this, [input, init]);
    } catch (fetchErr) {
      throw fetchErr;
    }

    // Only process candidates when capture is ON
    if (window.SHORTLINKER_INSPECTOR_ACTIVE) {
      const { isCandidate } = isCandidateRequest(urlStr, method);
      if (isCandidate) {
        try {
          const durationMs = Math.round(performance.now() - startTime);
          const parsedUrl = new URL(urlStr, window.location.origin);
          const { sanitizedBody, bodyType } = parseAndSanitizeBody(rawBody, contentType);
          const safeHeaders = filterSafeHeaders(reqHeaders);

          const captured: CapturedRequest = {
            id: `fetch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toLocaleTimeString(),
            method: method.toUpperCase(),
            url: parsedUrl.href,
            hostname: parsedUrl.hostname,
            pathname: parsedUrl.pathname,
            contentType: contentType || 'unspecified',
            safeHeaders,
            sanitizedBody,
            bodyType,
            status: response.status,
            statusText: response.statusText,
            durationMs,
            source: 'fetch'
          };

          broadcastCapture(captured);
        } catch (captureErr) {
          console.warn('[ShortLinker Interceptor] Error capturing fetch candidate:', captureErr);
        }
      }
    }

    // Return original response UNTOUCHED
    return response;
  };

  // ==========================================
  // 3. Passive XMLHttpRequest Interception
  // ==========================================
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  const xhrMetadataMap = new WeakMap<
    XMLHttpRequest,
    {
      method: string;
      url: string;
      headers: Record<string, string>;
      startTime: number;
    }
  >();

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    try {
      xhrMetadataMap.set(this, {
        method: method || 'GET',
        url: url.toString(),
        headers: {},
        startTime: performance.now()
      });
    } catch {
      // Ignore
    }
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    try {
      const meta = xhrMetadataMap.get(this);
      if (meta && name) {
        meta.headers[name] = value;
      }
    } catch {
      // Ignore
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMetadataMap.get(this);

    if (window.SHORTLINKER_INSPECTOR_ACTIVE && meta) {
      const { isCandidate } = isCandidateRequest(meta.url, meta.method);
      if (isCandidate) {
        this.addEventListener(
          'loadend',
          () => {
            try {
              const durationMs = Math.round(performance.now() - meta.startTime);
              const parsedUrl = new URL(meta.url, window.location.origin);
              const contentType = meta.headers['content-type'] || meta.headers['Content-Type'] || '';
              const { sanitizedBody, bodyType } = parseAndSanitizeBody(body, contentType);
              const safeHeaders = filterSafeHeaders(meta.headers);

              const captured: CapturedRequest = {
                id: `xhr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                timestamp: new Date().toLocaleTimeString(),
                method: meta.method.toUpperCase(),
                url: parsedUrl.href,
                hostname: parsedUrl.hostname,
                pathname: parsedUrl.pathname,
                contentType: contentType || 'unspecified',
                safeHeaders,
                sanitizedBody,
                bodyType,
                status: this.status,
                statusText: this.statusText,
                durationMs,
                source: 'xhr'
              };

              broadcastCapture(captured);
            } catch (captureErr) {
              console.warn('[ShortLinker Interceptor] Error capturing XHR candidate:', captureErr);
            }
          },
          { once: true }
        );
      }
    }

    return originalSend.call(this, body);
  };
}
