import { filterSafeHeaders, parseAndSanitizeBody, redactSensitiveData } from '../common/sanitizer';
import { isCandidateRequest, isRelatedVideoMutation } from '../common/filter';
import { buildRelatedVideoPayload } from '../common/youtube';
import { parseCreatorVideosResponse } from '../common/catalog-parser';
import {
  BRIDGE_EVENTS,
  CapturedRequest,
  RelatedVideoMutationMeta,
  ReplayResult,
  MutationExecutePayload,
  MutationItemProgress,
  MutationJobSummary,
  TargetVideo
} from '../types';

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

  // Volatile in-memory store for ONE captured Related Video mutation template
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
  let activeJobCancellationFlag = false;

  // In-memory catalog of creator's videos (volatily cached in MAIN world)
  const inMemoryCatalogMap: Map<string, TargetVideo> = new Map();
  let lastListVideosRequestTemplate: {
    url: string;
    headers: any;
    basePayload: any;
  } | null = null;

  console.info(
    '%c[ShortLinker Interceptor] Passive network listener installed in MAIN world (Status: OFF).',
    'background: #1e293b; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
  );

  // Broadcast catalog updates to isolated-world UI
  function broadcastCatalogUpdated() {
    const videos = Array.from(inMemoryCatalogMap.values());
    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.CATALOG_RESPONSE, {
        detail: { videos }
      })
    );
  }

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
      `%c[ShortLinker Interceptor] Related Video Mutation Template Ready: Short [${meta.sourceVideoId}] → Target [${meta.targetVideoId}]`,
      'background: #064e3b; color: #34d399; font-weight: bold; padding: 3px 8px; border-radius: 4px;'
    );
  }

  // Handle template status requests from UI
  document.addEventListener(BRIDGE_EVENTS.TEMPLATE_STATUS_REQUEST, () => {
    const responseEvent = new CustomEvent(BRIDGE_EVENTS.TEMPLATE_STATUS_RESPONSE, {
      detail: {
        hasTemplate: Boolean(lastRawMutation),
        sourceVideoId: lastRawMutation?.sourceVideoId,
        targetVideoId: lastRawMutation?.targetVideoId,
        timestamp: lastRawMutation?.timestamp
      }
    });
    document.dispatchEvent(responseEvent);
  });

  // Handle catalog requests from UI
  document.addEventListener(BRIDGE_EVENTS.CATALOG_REQUEST, () => {
    broadcastCatalogUpdated();
    // If catalog is currently empty, attempt to fetch videos
    if (inMemoryCatalogMap.size === 0) {
      fetchCreatorVideos().catch(() => {});
    }
  });

  // Handle refresh catalog request
  document.addEventListener(BRIDGE_EVENTS.REFRESH_CATALOG, () => {
    fetchCreatorVideos().catch(() => {});
  });

  async function fetchCreatorVideos(): Promise<TargetVideo[]> {
    const template = lastListVideosRequestTemplate;
    const mutationTemplate = lastRawMutation;

    const url = template?.url || 'https://studio.youtube.com/youtubei/v1/creator/list_creator_videos';
    const headers = template?.headers || mutationTemplate?.headers || {
      'content-type': 'application/json',
      'x-youtube-client-name': '62'
    };

    const context = template?.basePayload?.context || mutationTemplate?.rawBody?.context;
    const payload: any = {
      pageSize: 50
    };
    if (context) {
      payload.context = context;
    }

    try {
      const res = await originalFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'same-origin'
      });

      if (res.ok) {
        const text = await res.text();
        const json = JSON.parse(text);
        const videos = parseCreatorVideosResponse(json);
        if (videos.length > 0) {
          for (const v of videos) {
            inMemoryCatalogMap.set(v.id, v);
          }
          broadcastCatalogUpdated();
        }
        return videos;
      }
    } catch (err) {
      console.warn('[ShortLinker Interceptor] Error fetching creator videos:', err);
    }
    return [];
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

    // Passively observe creator video list responses
    if (
      urlStr.includes('/creator/list_creator_videos') ||
      urlStr.includes('/creator/get_creator_videos')
    ) {
      try {
        let parsedBody = rawBody;
        if (typeof rawBody === 'string') {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {}
        }
        lastListVideosRequestTemplate = {
          url: urlStr,
          headers: reqHeaders,
          basePayload: parsedBody
        };

        const resClone = response.clone();
        resClone.text().then((text) => {
          try {
            const json = JSON.parse(text);
            const videos = parseCreatorVideosResponse(json);
            if (videos.length > 0) {
              for (const v of videos) {
                inMemoryCatalogMap.set(v.id, v);
              }
              broadcastCatalogUpdated();
            }
          } catch {}
        });
      } catch {}
    }

    // Process potential Related Video mutations (always cache template if detected)
    const mutationCheck = isRelatedVideoMutation(urlStr, method, rawBody);
    if (mutationCheck.isRelatedVideoMutation && mutationCheck.sourceVideoId && mutationCheck.targetVideoId) {
      let parsedBodyForStorage = rawBody;
      if (typeof rawBody === 'string') {
        try {
          parsedBodyForStorage = JSON.parse(rawBody);
        } catch {
          parsedBodyForStorage = rawBody;
        }
      }

      lastRawMutation = {
        url: urlStr,
        method: method.toUpperCase(),
        headers: reqHeaders,
        rawBody: parsedBodyForStorage,
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
        httpStatus: response.status,
        pathname: new URL(urlStr, window.location.origin).pathname,
        flowType: mutationCheck.flowType,
        hasAttestation: Boolean(mutationCheck.hasAttestation)
      });
    }

    // Process general candidate requests if capture is ON
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

    if (meta) {
      this.addEventListener(
        'loadend',
        () => {
          try {
            // Passively observe creator video list in XHR
            if (
              meta.url.includes('/creator/list_creator_videos') ||
              meta.url.includes('/creator/get_creator_videos')
            ) {
              try {
                const text = this.responseText;
                if (text) {
                  const json = JSON.parse(text);
                  const videos = parseCreatorVideosResponse(json);
                  if (videos.length > 0) {
                    for (const v of videos) {
                      inMemoryCatalogMap.set(v.id, v);
                    }
                    broadcastCatalogUpdated();
                  }
                }
              } catch {}
            }

            const mutationCheck = isRelatedVideoMutation(meta.url, meta.method, body);
            if (mutationCheck.isRelatedVideoMutation && mutationCheck.sourceVideoId && mutationCheck.targetVideoId) {
              let parsedBodyForStorage = body;
              if (typeof body === 'string') {
                try {
                  parsedBodyForStorage = JSON.parse(body);
                } catch {
                  parsedBodyForStorage = body;
                }
              }

              lastRawMutation = {
                url: meta.url,
                method: meta.method.toUpperCase(),
                headers: meta.headers,
                rawBody: parsedBodyForStorage,
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
                pathname: new URL(meta.url, window.location.origin).pathname,
                flowType: mutationCheck.flowType,
                hasAttestation: Boolean(mutationCheck.hasAttestation)
              });
            }

            if (window.SHORTLINKER_INSPECTOR_ACTIVE) {
              const { isCandidate } = isCandidateRequest(meta.url, meta.method);
              if (isCandidate) {
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
              }
            }
          } catch (captureErr) {
            console.warn('[ShortLinker Interceptor] Error capturing XHR candidate:', captureErr);
          }
        },
        { once: true }
      );
    }

    return originalSend.call(this, body);
  };

  // ==========================================
  // 4. Single Mutation Replay (Debug / Verification)
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
      const payloadString =
        typeof lastRawMutation.rawBody === 'string'
          ? lastRawMutation.rawBody
          : JSON.stringify(lastRawMutation.rawBody);

      const response = await originalFetch(lastRawMutation.url, {
        method: lastRawMutation.method,
        headers: lastRawMutation.headers,
        body: payloadString,
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

  // ==========================================
  // 5. Execution Pipeline (Single & Multi-Short)
  // ==========================================
  document.addEventListener(BRIDGE_EVENTS.CANCEL_MUTATION, () => {
    activeJobCancellationFlag = true;
    console.info('[ShortLinker Interceptor] Cancel signal received for active mutation queue.');
  });

  document.addEventListener(BRIDGE_EVENTS.EXECUTE_MUTATION, (async (evt: Event) => {
    const event = evt as CustomEvent<MutationExecutePayload>;
    const payload = event.detail;
    if (!payload || !payload.sourceShortIds || payload.sourceShortIds.length === 0) {
      return;
    }

    const { jobId, sourceShortIds, targetVideoId, delayMs = 800 } = payload;
    activeJobCancellationFlag = false;

    if (!lastRawMutation) {
      const failedSummary: MutationJobSummary = {
        jobId,
        total: sourceShortIds.length,
        completed: sourceShortIds.length,
        succeeded: 0,
        failed: sourceShortIds.length,
        isCancelled: false,
        items: sourceShortIds.map((id) => ({
          sourceShortId: id,
          targetVideoId,
          status: 'failed',
          httpStatus: 0,
          error: 'Mutation template required. Please save a Related Video manually in Studio first.'
        }))
      };
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_COMPLETE, { detail: failedSummary }));
      return;
    }

    console.info(
      `%c[ShortLinker Queue] Starting execution of ${sourceShortIds.length} Short(s) with target [${targetVideoId}]`,
      'background: #1e3a8a; color: #60a5fa; font-weight: bold; padding: 3px 8px; border-radius: 4px;'
    );

    const items: MutationItemProgress[] = [];
    let succeededCount = 0;
    let failedCount = 0;

    for (let i = 0; i < sourceShortIds.length; i++) {
      const sourceShortId = sourceShortIds[i];

      // Check if user cancelled
      if (activeJobCancellationFlag) {
        const cancelledItem: MutationItemProgress = {
          sourceShortId,
          targetVideoId,
          status: 'cancelled',
          error: 'Operation cancelled by user'
        };
        items.push(cancelledItem);
        document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: cancelledItem }));
        continue;
      }

      // Signal running state for current item
      const runningProgress: MutationItemProgress = {
        sourceShortId,
        targetVideoId,
        status: 'running'
      };
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: runningProgress }));

      const startTime = performance.now();
      try {
        const reqBody = buildRelatedVideoPayload(
          lastRawMutation.rawBody,
          sourceShortId,
          targetVideoId
        );

        const response = await originalFetch(lastRawMutation.url, {
          method: 'POST',
          headers: lastRawMutation.headers,
          body: JSON.stringify(reqBody),
          credentials: 'same-origin'
        });

        const durationMs = Math.round(performance.now() - startTime);
        const responseText = await response.text();

        let isSuccess = response.ok && response.status === 200;
        let attestationRejected = false;
        let errorMsg = '';

        try {
          const parsed = JSON.parse(responseText);
          if (parsed.error || response.status >= 400) {
            isSuccess = false;
            errorMsg = parsed.error?.message || parsed.error?.status || response.statusText;
            const errStr = JSON.stringify(parsed.error || '').toLowerCase();
            if (errStr.includes('attestation') || errStr.includes('challenge') || errStr.includes('token')) {
              attestationRejected = true;
            }
          }
        } catch {
          if (!response.ok) {
            isSuccess = false;
            errorMsg = response.statusText || `HTTP ${response.status}`;
          }
        }

        const itemResult: MutationItemProgress = {
          sourceShortId,
          targetVideoId,
          status: isSuccess ? 'success' : 'failed',
          httpStatus: response.status,
          statusText: response.statusText,
          durationMs,
          error: errorMsg || undefined,
          attestationRejected
        };

        if (isSuccess) {
          succeededCount++;
        } else {
          failedCount++;
        }

        items.push(itemResult);
        document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: itemResult }));

        if (i < sourceShortIds.length - 1 && !activeJobCancellationFlag && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (err: any) {
        failedCount++;
        const durationMs = Math.round(performance.now() - startTime);
        const itemResult: MutationItemProgress = {
          sourceShortId,
          targetVideoId,
          status: 'failed',
          httpStatus: 0,
          statusText: 'Network Exception',
          durationMs,
          error: err?.message || 'Network exception during fetch'
        };
        items.push(itemResult);
        document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: itemResult }));
      }
    }

    const summary: MutationJobSummary = {
      jobId,
      total: sourceShortIds.length,
      completed: items.length,
      succeeded: succeededCount,
      failed: failedCount,
      isCancelled: activeJobCancellationFlag,
      items
    };

    console.info(
      `%c[ShortLinker Queue] Completed job ${jobId}: ${succeededCount} succeeded, ${failedCount} failed`,
      `font-weight: bold; color: ${failedCount === 0 ? '#22c55e' : '#f59e0b'};`
    );

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_COMPLETE, { detail: summary }));
  }) as EventListener);
}
