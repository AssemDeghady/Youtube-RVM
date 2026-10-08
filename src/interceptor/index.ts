/**
 * ShortLinker MAIN-World Interceptor & Listing-Page Mutation Engine
 * 
 * Runs in YouTube Studio's MAIN execution world to:
 * 1. Passively observe Creator Video catalog responses to populate target picker.
 * 2. Observe manual Related Video saves to capture an authenticated mutation template
 *    in VOLATILE MEMORY ONLY (never persisted to disk, localStorage, chrome.storage, or sent externally).
 * 3. Execute bulk Related Video mutations directly from the Shorts listing page
 *    without ANY page navigation, using Studio's own authenticated session.
 * 4. Passively report sanitized structural diagnostics when enabled (all credentials REDACTED).
 */

import { parseCreatorVideosResponse } from '../common/catalog-parser';
import { analyzeJsonStructure, filterSafeHeaders } from '../common/sanitizer';
import { isRelatedVideoMutation } from '../common/filter';
import { buildRelatedVideoPayload } from '../common/youtube';
import { classifyError } from '../common/error-classifier';
import {
  BRIDGE_EVENTS,
  TargetVideo,
  RelatedVideoMutationMeta,
  MutationExecutePayload,
  MutationItemProgress,
  MutationJobSummary
} from '../types';

declare global {
  interface Window {
    SHORTLINKER_MAIN_INTERCEPTOR_INSTALLED?: boolean;
    SHORTLINKER_DIAGNOSTICS_ACTIVE?: boolean;
  }
}

if (window.SHORTLINKER_MAIN_INTERCEPTOR_INSTALLED) {
  // Already installed
} else {
  window.SHORTLINKER_MAIN_INTERCEPTOR_INSTALLED = true;
  window.SHORTLINKER_DIAGNOSTICS_ACTIVE = false;

  // =========================================================================
  // Volatile In-Memory State
  // NEVER persisted, NEVER exported, NEVER written to storage.
  // =========================================================================
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
  let isJobExecuting = false;
  let activeJobCancellationFlag = false;

  // In-memory creator videos observed from Studio's catalog responses
  const inMemoryCatalogMap: Map<string, TargetVideo> = new Map();

  // =========================================================================
  // Catalog Helpers
  // =========================================================================
  function broadcastCatalogUpdated() {
    const videos = Array.from(inMemoryCatalogMap.values());
    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.CATALOG_RESPONSE, {
        detail: { videos }
      })
    );
  }

  document.addEventListener(BRIDGE_EVENTS.CATALOG_REQUEST, () => {
    broadcastCatalogUpdated();
  });

  document.addEventListener(BRIDGE_EVENTS.REFRESH_CATALOG, () => {
    broadcastCatalogUpdated();
  });

  // =========================================================================
  // Template Status & Diagnostics Listeners
  // =========================================================================
  function broadcastTemplateStatus() {
    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.TEMPLATE_STATUS_RESPONSE, {
        detail: {
          hasTemplate: Boolean(lastRawMutation),
          sourceVideoId: lastRawMutation?.sourceVideoId,
          targetVideoId: lastRawMutation?.targetVideoId,
          timestamp: lastRawMutation?.timestamp
        }
      })
    );
  }

  document.addEventListener(BRIDGE_EVENTS.TEMPLATE_STATUS_REQUEST, () => {
    broadcastTemplateStatus();
  });

  document.addEventListener(BRIDGE_EVENTS.CLEAR_TEMPLATE, () => {
    lastRawMutation = null;
    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
      console.info('[ShortLinker Interceptor] Mutation template purged from volatile memory.');
    }
    broadcastTemplateStatus();
  });

  document.addEventListener(BRIDGE_EVENTS.DIAGNOSTIC_CONTROL, ((event: CustomEvent<{ active: boolean }>) => {
    if (event.detail && typeof event.detail.active === 'boolean') {
      window.SHORTLINKER_DIAGNOSTICS_ACTIVE = event.detail.active;
      console.info(
        `%c[ShortLinker Diagnostics] Network observation ${event.detail.active ? 'ENABLED' : 'DISABLED'}.`,
        `font-weight: bold; color: ${event.detail.active ? '#22c55e' : '#f97316'};`
      );
    }
  }) as EventListener);

  function broadcastSafeNetworkDiagnostic(detail: {
    method: string;
    url: string;
    status: number | null;
    durationMs: number | null;
    initiator?: string;
    requestStructure?: any;
    responseStructure?: any;
  }) {
    if (!window.SHORTLINKER_DIAGNOSTICS_ACTIVE) return;
    document.dispatchEvent(
      new CustomEvent(BRIDGE_EVENTS.DIAGNOSTIC_NETWORK, {
        detail
      })
    );
  }

  function handleDetectedMutation(
    urlStr: string,
    method: string,
    reqHeaders: any,
    rawBody: any,
    mutationCheck: ReturnType<typeof isRelatedVideoMutation>,
    httpStatus?: number
  ) {
    if (!mutationCheck.isRelatedVideoMutation || !mutationCheck.sourceVideoId || !mutationCheck.targetVideoId) {
      return;
    }

    let parsedBodyForStorage = rawBody;
    if (typeof rawBody === 'string') {
      try {
        parsedBodyForStorage = JSON.parse(rawBody);
      } catch {
        parsedBodyForStorage = rawBody;
      }
    }

    // Retain only in volatile memory for the active browser session
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

    const meta: RelatedVideoMutationMeta = {
      sourceVideoId: mutationCheck.sourceVideoId,
      targetVideoId: mutationCheck.targetVideoId,
      timestamp: new Date().toLocaleTimeString(),
      httpStatus,
      pathname: new URL(urlStr, window.location.origin).pathname,
      flowType: mutationCheck.flowType,
      hasAttestation: Boolean(mutationCheck.hasAttestation)
    };

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_DETECTED, { detail: meta }));
    broadcastTemplateStatus();
  }

  // =========================================================================
  // Passive XMLHttpRequest Interception
  // =========================================================================
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  const xhrMetaMap = new WeakMap<
    XMLHttpRequest,
    {
      method: string;
      url: string;
      headers: Record<string, string>;
      startTime: number;
      rawBody?: any;
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
      xhrMetaMap.set(this, {
        method: (method || 'GET').toUpperCase(),
        url: url.toString(),
        headers: {},
        startTime: performance.now()
      });
    } catch {}
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header: string, value: string) {
    const meta = xhrMetaMap.get(this);
    if (meta) {
      meta.headers[header.toLowerCase()] = value;
    }
    return originalSetRequestHeader.call(this, header, value);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMetaMap.get(this);
    const urlStr = meta?.url || '';
    const method = meta?.method || 'GET';
    const startTime = meta?.startTime || performance.now();
    const reqHeaders = meta?.headers || {};

    let requestStructure: any = undefined;
    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE && body && typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        requestStructure = analyzeJsonStructure(parsed);
      } catch {}
    }

    this.addEventListener(
      'loadend',
      () => {
        const durationMs = Math.round(performance.now() - startTime);

        // 1. Check for Related Video mutation save
        const mutationCheck = isRelatedVideoMutation(urlStr, method, body);
        if (mutationCheck.isRelatedVideoMutation) {
          handleDetectedMutation(urlStr, method, reqHeaders, body, mutationCheck, this.status);
        }

        // 2. Passively observe creator video catalog endpoints
        if (
          urlStr.includes('/creator/list_creator_videos') ||
          urlStr.includes('/creator/get_creator_videos')
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

        // 3. Safe diagnostic network reporting
        if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
          let responseStructure: any = undefined;
          try {
            if (this.responseText && (urlStr.includes('youtubei') || urlStr.includes('creator'))) {
              const parsed = JSON.parse(this.responseText);
              responseStructure = analyzeJsonStructure(parsed);
            }
          } catch {}

          broadcastSafeNetworkDiagnostic({
            method: method.toUpperCase(),
            url: urlStr,
            status: this.status,
            durationMs,
            initiator: 'xhr',
            requestStructure,
            responseStructure
          });
        }
      },
      { once: true }
    );

    return originalSend.call(this, body);
  };

  // =========================================================================
  // Passive window.fetch Interception
  // =========================================================================
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startTime = performance.now();
    let urlStr = '';
    let method = 'GET';
    let rawBody: any = null;
    let reqHeaders: any = null;
    let requestStructure: any = undefined;

    try {
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        urlStr = input.url;
        method = input.method;
        reqHeaders = input.headers;
        if (input.body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
          try {
            const clone = input.clone();
            rawBody = await clone.text();
          } catch {}
        }
      }

      if (init) {
        if (init.method) method = init.method;
        if (init.body !== undefined && init.body !== null) rawBody = init.body;
        if (init.headers) reqHeaders = init.headers;
      }

      if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE && rawBody && typeof rawBody === 'string') {
        try {
          const parsed = JSON.parse(rawBody);
          requestStructure = analyzeJsonStructure(parsed);
        } catch {}
      }
    } catch {}

    const response = await originalFetch.call(this, input, init);
    const durationMs = Math.round(performance.now() - startTime);

    // 1. Check for Related Video mutation save
    const mutationCheck = isRelatedVideoMutation(urlStr, method, rawBody);
    if (mutationCheck.isRelatedVideoMutation) {
      handleDetectedMutation(urlStr, method, reqHeaders, rawBody, mutationCheck, response.status);
    }

    // 2. Passively observe creator video list in fetch responses
    if (
      urlStr.includes('/creator/list_creator_videos') ||
      urlStr.includes('/creator/get_creator_videos')
    ) {
      try {
        const clone = response.clone();
        clone
          .text()
          .then((text) => {
            const json = JSON.parse(text);
            const videos = parseCreatorVideosResponse(json);
            if (videos.length > 0) {
              for (const v of videos) {
                inMemoryCatalogMap.set(v.id, v);
              }
              broadcastCatalogUpdated();
            }
          })
          .catch(() => {});
      } catch {}
    }

    // 3. Safe diagnostic network reporting
    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
      try {
        const clone = response.clone();
        clone
          .text()
          .then((text) => {
            let responseStructure: any = undefined;
            try {
              if (text && (urlStr.includes('youtubei') || urlStr.includes('creator'))) {
                const parsed = JSON.parse(text);
                responseStructure = analyzeJsonStructure(parsed);
              }
            } catch {}

            broadcastSafeNetworkDiagnostic({
              method: method.toUpperCase(),
              url: urlStr,
              status: response.status,
              durationMs,
              initiator: 'fetch',
              requestStructure,
              responseStructure
            });
          })
          .catch(() => {
            broadcastSafeNetworkDiagnostic({
              method: method.toUpperCase(),
              url: urlStr,
              status: response.status,
              durationMs,
              initiator: 'fetch',
              requestStructure
            });
          });
      } catch {
        broadcastSafeNetworkDiagnostic({
          method: method.toUpperCase(),
          url: urlStr,
          status: response.status,
          durationMs,
          initiator: 'fetch',
          requestStructure
        });
      }
    }

    return response;
  };

  // =========================================================================
  // Listing-Page Bulk Mutation Engine (Sequential Replay)
  // =========================================================================
  document.addEventListener(BRIDGE_EVENTS.CANCEL_MUTATION, () => {
    activeJobCancellationFlag = true;
    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
      console.info('[ShortLinker Interceptor] Cancel signal received for listing-page bulk mutation.');
    }
  });

  document.addEventListener(BRIDGE_EVENTS.EXECUTE_MUTATION, (async (evt: Event) => {
    const event = evt as CustomEvent<MutationExecutePayload>;
    const payload = event.detail;
    if (!payload || !payload.sourceShortIds || payload.sourceShortIds.length === 0) {
      return;
    }

    const { jobId, sourceShortIds, targetVideoId, delayMs = 800 } = payload;

    // Double-submit protection: prevent duplicate execution
    if (isJobExecuting) {
      if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
        console.warn('[ShortLinker Interceptor] A bulk job is already in progress. Ignoring duplicate trigger.');
      }
      return;
    }

    // Calibration check: template required
    if (!lastRawMutation) {
      const failedSummary: MutationJobSummary = {
        jobId,
        total: sourceShortIds.length,
        completed: sourceShortIds.length,
        succeeded: 0,
        failed: sourceShortIds.length,
        notAttempted: 0,
        isCancelled: false,
        failedItemIds: [...sourceShortIds],
        items: sourceShortIds.map((id) => {
          const classified = classifyError('Mutation template required. Please save a Related Video manually in Studio first.');
          return {
            sourceShortId: id,
            targetVideoId,
            status: 'failed',
            httpStatus: 0,
            error: classified.userMessage,
            classifiedError: classified
          };
        })
      };
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_COMPLETE, { detail: failedSummary }));
      return;
    }

    isJobExecuting = true;
    activeJobCancellationFlag = false;

    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
      console.info(
        `%c[ShortLinker Queue] Starting listing-page bulk assignment: ${sourceShortIds.length} Short(s) → Target [${targetVideoId}]`,
        'background: #1e3a8a; color: #60a5fa; font-weight: bold; padding: 3px 8px; border-radius: 4px;'
      );
    }

    const items: MutationItemProgress[] = [];
    const failedItemIds: string[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    let notAttemptedCount = 0;

    for (let i = 0; i < sourceShortIds.length; i++) {
      const sourceShortId = sourceShortIds[i];

      // Check if user clicked Stop
      if (activeJobCancellationFlag) {
        notAttemptedCount++;
        const classified = classifyError('Operation cancelled by user');
        const cancelledItem: MutationItemProgress = {
          sourceShortId,
          targetVideoId,
          status: 'not_attempted',
          error: classified.userMessage,
          classifiedError: classified
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
        // Construct request payload with this specific Short ID
        const reqBody = buildRelatedVideoPayload(
          lastRawMutation.rawBody,
          sourceShortId,
          targetVideoId
        );

        // Execute mutation directly using Studio's authenticated page session
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
        let rawErrorMsg = '';

        try {
          const parsed = JSON.parse(responseText);
          if (parsed.error || response.status >= 400) {
            isSuccess = false;
            rawErrorMsg = parsed.error?.message || parsed.error?.status || response.statusText;
            const errStr = JSON.stringify(parsed.error || '').toLowerCase();
            if (errStr.includes('attestation') || errStr.includes('challenge') || errStr.includes('token') || errStr.includes('rejected')) {
              attestationRejected = true;
            }
          }
        } catch {
          if (!response.ok) {
            isSuccess = false;
            rawErrorMsg = response.statusText || `HTTP ${response.status}`;
          }
        }

        if (isSuccess) {
          succeededCount++;
          const itemResult: MutationItemProgress = {
            sourceShortId,
            targetVideoId,
            status: 'success',
            httpStatus: response.status,
            statusText: response.statusText,
            durationMs
          };
          items.push(itemResult);
          document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: itemResult }));
        } else {
          failedCount++;
          failedItemIds.push(sourceShortId);
          const classified = classifyError(rawErrorMsg, response.status, attestationRejected);
          const itemResult: MutationItemProgress = {
            sourceShortId,
            targetVideoId,
            status: 'failed',
            httpStatus: response.status,
            statusText: response.statusText,
            durationMs,
            error: classified.userMessage,
            classifiedError: classified,
            attestationRejected
          };
          items.push(itemResult);
          document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: itemResult }));
        }

        // Safe diagnostic record
        if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
          broadcastSafeNetworkDiagnostic({
            method: 'POST',
            url: lastRawMutation.url,
            status: response.status,
            durationMs,
            initiator: 'shortlinker-engine',
            requestStructure: analyzeJsonStructure(reqBody),
            responseStructure: { status: response.status, ok: isSuccess }
          });
        }

        // Sequential delay between items if more remain and not cancelled
        if (i < sourceShortIds.length - 1 && !activeJobCancellationFlag && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (err: any) {
        failedCount++;
        failedItemIds.push(sourceShortId);
        const durationMs = Math.round(performance.now() - startTime);
        const classified = classifyError(err?.message || 'Network exception during fetch', 0);
        const itemResult: MutationItemProgress = {
          sourceShortId,
          targetVideoId,
          status: 'failed',
          httpStatus: 0,
          statusText: 'Network Exception',
          durationMs,
          error: classified.userMessage,
          classifiedError: classified
        };
        items.push(itemResult);
        document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_PROGRESS, { detail: itemResult }));
      }
    }

    const summary: MutationJobSummary = {
      jobId,
      total: sourceShortIds.length,
      completed: succeededCount + failedCount,
      succeeded: succeededCount,
      failed: failedCount,
      notAttempted: notAttemptedCount,
      isCancelled: activeJobCancellationFlag,
      failedItemIds,
      items
    };

    if (window.SHORTLINKER_DIAGNOSTICS_ACTIVE) {
      console.info(
        `%c[ShortLinker Queue] Completed bulk job ${jobId}: ${succeededCount} succeeded, ${failedCount} failed, ${notAttemptedCount} not attempted`,
        `font-weight: bold; color: ${failedCount === 0 ? '#22c55e' : '#f59e0b'};`
      );
    }

    document.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.MUTATION_COMPLETE, { detail: summary }));
    isJobExecuting = false;
  }) as EventListener);
}
