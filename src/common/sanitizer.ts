import { BodyRepresentationType } from '../types';

const SENSITIVE_KEY_REGEX =
  /(token|auth|authorization|cookie|cookies|sapisid|access_token|refresh_token|password|session|credential|secret|key|identity)/i;

const SAFE_HEADER_NAMES = new Set([
  'content-type',
  'accept',
  'x-youtube-client-name',
  'x-youtube-client-version',
  'x-goog-authuser',
  'x-origin'
]);

/**
 * Redacts any string value that appears to contain sensitive tokens or hashes.
 */
function sanitizeStringValue(str: string): string {
  // Redact Bearer / SAPISID / Google OAuth tokens
  return str
    .replace(/SAPISIDHASH\s+[a-f0-9_]+/gi, 'SAPISIDHASH [REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[a-zA-Z0-9_\-]+/g, 'ya29.[REDACTED]');
}

/**
 * Recursively redacts sensitive keys and values from objects and arrays.
 */
export function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeStringValue(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    }
    return redacted;
  }

  return '[Unserializable]';
}

/**
 * Sanitizes headers, strictly ensuring no sensitive headers (Authorization, Cookie, SAPISID) are kept.
 */
export function filterSafeHeaders(headers: Headers | Record<string, string> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (SAFE_HEADER_NAMES.has(lowerKey)) {
        result[lowerKey] = sanitizeStringValue(value);
      } else if (!SENSITIVE_KEY_REGEX.test(lowerKey)) {
        // Record only non-sensitive header names, redacting values unless on safe list
        result[lowerKey] = `[Header present]`;
      }
    });
  } else if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (SAFE_HEADER_NAMES.has(lowerKey)) {
        result[lowerKey] = sanitizeStringValue(String(value));
      } else if (!SENSITIVE_KEY_REGEX.test(lowerKey)) {
        result[lowerKey] = `[Header present]`;
      }
    }
  }

  return result;
}

/**
 * Safely parses and redacts request bodies (JSON, FormData, URLSearchParams, text).
 */
export function parseAndSanitizeBody(
  rawBody: any,
  contentType: string
): { sanitizedBody: any; bodyType: BodyRepresentationType } {
  if (rawBody === null || rawBody === undefined || rawBody === '') {
    return { sanitizedBody: null, bodyType: 'empty' };
  }

  // Handle URLSearchParams
  if (typeof URLSearchParams !== 'undefined' && rawBody instanceof URLSearchParams) {
    const paramsObj: Record<string, string> = {};
    rawBody.forEach((value, key) => {
      paramsObj[key] = SENSITIVE_KEY_REGEX.test(key) ? '[REDACTED]' : sanitizeStringValue(value);
    });
    return { sanitizedBody: paramsObj, bodyType: 'url-encoded' };
  }

  // Handle FormData
  if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
    const formObj: Record<string, any> = {};
    rawBody.forEach((value, key) => {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        formObj[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        formObj[key] = sanitizeStringValue(value);
      } else {
        formObj[key] = `[File: ${(value as File).name || 'blob'}]`;
      }
    });
    return { sanitizedBody: formObj, bodyType: 'form-data' };
  }

  // Handle String Body (JSON or Text or URLSearchParams)
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return { sanitizedBody: redactSensitiveData(parsed), bodyType: 'json' };
      } catch {
        // Not valid JSON, continue to text fallback
      }
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const params = new URLSearchParams(trimmed);
        const paramsObj: Record<string, string> = {};
        params.forEach((value, key) => {
          paramsObj[key] = SENSITIVE_KEY_REGEX.test(key) ? '[REDACTED]' : sanitizeStringValue(value);
        });
        return { sanitizedBody: paramsObj, bodyType: 'url-encoded' };
      } catch {
        // Fallback
      }
    }

    return { sanitizedBody: sanitizeStringValue(trimmed), bodyType: 'text' };
  }

  // Handle Object Body (already parsed)
  if (typeof rawBody === 'object') {
    return { sanitizedBody: redactSensitiveData(rawBody), bodyType: 'json' };
  }

  return { sanitizedBody: '[Binary or unsupported body format]', bodyType: 'binary/unsupported' };
}
