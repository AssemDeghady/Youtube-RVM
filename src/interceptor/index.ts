import { filterSafeHeaders, parseAndSanitizeBody, redactSensitiveData } from '../common/sanitizer';
import { isCandidateRequest, isRelatedVideoMutation } from '../common/filter';
import { BRIDGE_EVENTS, CapturedRequest, RelatedVideoMutationMeta, ReplayResult } from '../types';

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

  // Volatile in-memory store for ONE captured Related Video mutation
  // NEVER persisted to storage, files, or external networks.
  interface StoredRawMutation {
    url: string;
    method: string;
    headers: any;
    rawBody: any;
    sourceVideoId: string;
    targetVideoId: string;
    timestamp: string;
    flowType?: string;
    hasAttestation: boolean;
  }
  let lastRawMutation: StoredRawMutation | null = null;

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
    const customEvent = new CustomEvent(BRIDGE_EVENTS.CAPTURE, {
      detail: captured
    });
    document.dispatchEvent(customEvent);

    const style = 'background: #0f172a; color: #a855f7; font-weight: bold; padding: 2px 6px; border-radius: 4px;';
    console.groupCollapsed(`%c[ShortLinker Interceptor] Candidate Captured: [${captured.method}] ${captured.pathname}`, style);
    console.log('%cURL:', 'font-weight: bold;', captured.url);
    console.log('%cStatus:', 'font-weight: bold;', captured.status, captured.statusText);
    console.log('%cSafe Headers:', 'font-weight: bold;', captured.safeHeaders);
    console.log('%cSanitized Request Body (%s):', 'font-weight: bold;', captured.bodyType, captured.sanitizedBody);
    console.groupEnd();
  }

  function broadcastMutationDetected(meta: RelatedVideoMutationMeta) {
    const customEvent = new CustomEvent(BRIDGE_EVENTS.MUTATION_DETECTED, {
      detail: meta
    });
    document.dispatchEvent(customEvent);

    console.info(
      `%c[ShortLinker Interceptor] Related Video Mutation Detected: Short [${meta.sourceVideoId}] → Target [${meta.targetVideoId}]`,
      'background: #064e3b; color: #34d399; font-weight: bold; padding: 3px 8px; border-radius: 4px;'
    );
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

          // Check specifically for Related Video mutation
          const mutationCheck = isRelatedVideoMutation(urlStr, method, rawBody);
          if (mutationCheck.isRelatedVideoMutation && mutationCheck.sourceVideoId && mutationCheck.targetVideoId) {
            // Save raw request into volatile memory ONLY
            lastRawMutation = {
              url: urlStr,
              method: method.toUpperCase(),
              headers: reqHeaders,
              rawBody,
              sourceVideoId: mutationCheck.sourceVideoId,
              targetVideoId: mutationCheck.targetVideoId,
              timestamp: new Date().toLocaleTimeString(),
              flowType: mutationCheck.flowType,
              hasAttestation: Boolean(mutationCheck.hasAttestation)
            };

            // Broadcast safe metadata to Isolated UI (credentials strictly excluded)
            broadcastMutationDetected({
              sourceVideoId: mutationCheck.sourceVideoId,
              targetVideoId: mutationCheck.targetVideoId,
              timestamp: new Date().toLocaleTimeString(),
              httpStatus: response.status,
              pathname: parsedUrl.pathname,
              flowType: mutationCheck.flowType,
              hasAttestation: Boolean(mutationCheck.hasAttestation)
            });
          }
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

              const mutationCheck = isRelatedVideoMutation(meta.url, meta.method, body);
              if (mutationCheck.isRelatedVideoMutation && mutationCheck.sourceVideoId && mutationCheck.targetVideoId) {
                lastRawMutation = {
                  url: meta.url,
                  method: meta.method.toUpperCase(),
                  headers: meta.headers,
                  rawBody: body,
                  sourceVideoId: mutationCheck.sourceVideoId,
                  targetVideoId: mutationCheck.targetVideoId,
                  timestamp: new Date().toLocaleTimeString(),
                  flowType: mutationCheck.flowType,
                  hasAttestation: Boolean(mutationCheck.hasAttestation)
                };

                broadcastMutationDetected({
                  sourceVideoId: mutationCheck.sourceVideoId,
                  targetVideoId: mutationCheck.targetVideoId,
                  timestamp: new Date().toLocaleTimeString(),
                  httpStatus: this.status,
                  pathname: parsedUrl.pathname,
                  flowType: mutationCheck.flowType,
                  hasAttestation: Boolean(mutationCheck.hasAttestation)
                });
              }
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

  // ==========================================
  // 4. Controlled Single-Mutation Replay
  // ==========================================
  document.addEventListener(BRIDGE_EVENTS.REPLAY_REQUEST, async () => {
    if (!lastRawMutation) {
      const emptyResult: ReplayResult = {
        success: false,
        httpStatus: 0,
        statusText: 'No captured mutation in memory',
        durationMs: 0,
        sourceVideoId: '',
        targetVideoId: '',
        timestamp: new Date().toLocaleTimeString(),
        sanitizedResponseSnippet: 'No active Related Video mutation has been captured yet.'
      };
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REPLAY_RESPONSE, { detail: emptyResult }));
      return;
    }

    console.info(
      `%c[ShortLinker Replay] Executing single-video replay: Short [${lastRawMutation.sourceVideoId}] → Target [${lastRawMutation.targetVideoId}]`,
      'background: #1e3a8a; color: #60a5fa; font-weight: bold; padding: 3px 8px; border-radius: 4px;'
    );

    const startTime = performance.now();
    try {
      // Replay in MAIN-world page context using the captured headers and body
      const response = await originalFetch(lastRawMutation.url, {
        method: lastRawMutation.method,
        headers: lastRawMutation.headers,
        body: lastRawMutation.rawBody,
        credentials: 'same-origin'
      });

      const durationMs = Math.round(performance.now() - startTime);
      const responseText = await response.text();

      let sanitizedSnippet = '';
      let attestationRejected = false;

      try {
        const parsed = JSON.parse(responseText);
        if (parsed.error || response.status >= 400) {
          const errDetail = JSON.stringify(parsed.error || '').toLowerCase();
          if (errDetail.includes('attestation') || errDetail.includes('challenge') || errDetail.includes('token')) {
            attestationRejected = true;
          }
        }
        sanitizedSnippet = JSON.stringify(redactSensitiveData(parsed), null, 2);
        if (sanitizedSnippet.length > 600) {
          sanitizedSnippet = sanitizedSnippet.slice(0, 600) + '\n... (truncated)';
        }
      } catch {
        sanitizedSnippet = responseText.slice(0, 300);
      }

      const isSuccess = response.ok && response.status === 200;

      const result: ReplayResult = {
        success: isSuccess,
        httpStatus: response.status,
        statusText: response.statusText || (isSuccess ? 'OK' : 'Error'),
        durationMs,
        sourceVideoId: lastRawMutation.sourceVideoId,
        targetVideoId: lastRawMutation.targetVideoId,
        timestamp: new Date().toLocaleTimeString(),
        sanitizedResponseSnippet: sanitizedSnippet,
        attestationRejected
      };

      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REPLAY_RESPONSE, { detail: result }));

      console.info(
        `%c[ShortLinker Replay] Result: ${isSuccess ? 'SUCCESS' : 'FAILED'} (HTTP ${response.status})`,
        `font-weight: bold; color: ${isSuccess ? '#22c55e' : '#ef4444'};`,
        result
      );
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const result: ReplayResult = {
        success: false,
        httpStatus: 0,
        statusText: 'Network / Fetch Exception',
        durationMs,
        sourceVideoId: lastRawMutation.sourceVideoId,
        targetVideoId: lastRawMutation.targetVideoId,
        timestamp: new Date().toLocaleTimeString(),
        sanitizedResponseSnippet: err?.message || 'Unknown network error'
      };
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.REPLAY_RESPONSE, { detail: result }));
    }
  });
}
