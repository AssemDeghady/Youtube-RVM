import { BodyRepresentationType } from '../types';
import { isValidYouTubeVideoId } from './youtube';

export const SENSITIVE_KEY_REGEX =
  /(token|auth|authorization|cookie|cookies|sapisid|sapisidhash|access_token|refresh_token|password|session|credential|secret|key|identity|sid|hsid|ssid|botguard|attestation|challenge)/i;

export const SENSITIVE_QUERY_PARAM_REGEX =
  /^(access_token|token|auth|authorization|credential|code|session|sid|sapisid|hsid|ssid|key|api_key|secret)$/i;

const SAFE_HEADER_NAMES = new Set([
  'content-type',
  'accept',
  'x-youtube-client-name',
  'x-youtube-client-version',
  'x-goog-authuser',
  'x-origin'
]);

/**
 * Redacts any string value that appears to contain sensitive tokens, hashes, or cookies.
 */
export function sanitizeStringValue(str: string): string {
  if (typeof str !== 'string') return String(str);

  return str
    .replace(/SAPISIDHASH\s+[a-f0-9_]+/gi, 'SAPISIDHASH [REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[a-zA-Z0-9_\-]+/g, 'ya29.[REDACTED]')
    .replace(/(?:^|;\s*)(SAPISID|__Secure-3PAPISID|SID|HSID|SSID)=([^;]+)/gi, '$1=[REDACTED]');
}

/**
 * Sanitizes URLs and their query strings, strictly redacting sensitive tokens and credentials.
 */
export function sanitizeUrl(urlStr: string): {
  sanitizedUrl: string;
  origin: string;
  pathname: string;
  queryKeys: string[];
  sanitizedQueryParams: Record<string, string>;
} {
  try {
    const url = new URL(urlStr, 'https://studio.youtube.com');
    const queryKeys: string[] = [];
    const sanitizedQueryParams: Record<string, string> = {};

    url.searchParams.forEach((value, key) => {
      queryKeys.push(key);
      if (SENSITIVE_QUERY_PARAM_REGEX.test(key) || SENSITIVE_KEY_REGEX.test(key)) {
        sanitizedQueryParams[key] = '[REDACTED]';
        url.searchParams.set(key, '[REDACTED]');
      } else {
        const sanitizedVal = sanitizeStringValue(value);
        sanitizedQueryParams[key] = sanitizedVal;
        url.searchParams.set(key, sanitizedVal);
      }
    });

    return {
      sanitizedUrl: url.href,
      origin: url.origin,
      pathname: url.pathname,
      queryKeys,
      sanitizedQueryParams
    };
  } catch {
    return {
      sanitizedUrl: sanitizeStringValue(urlStr),
      origin: 'unknown',
      pathname: urlStr.split('?')[0] || urlStr,
      queryKeys: [],
      sanitizedQueryParams: {}
    };
  }
}

/**
 * Recursively inspects JSON objects and returns safe structural metadata without sensitive values.
 */
export function analyzeJsonStructure(obj: any, depth = 0): any {
  if (depth > 6) return '[Max Depth Exceeded]';
  if (obj === null) return { type: 'null' };
  if (obj === undefined) return { type: 'undefined' };

  if (typeof obj === 'string') {
    if (SENSITIVE_KEY_REGEX.test(obj)) {
      return '[REDACTED]';
    }
    const trimmed = obj.trim();
    if (isValidYouTubeVideoId(trimmed)) {
      return { type: 'string', length: 11, looksLikeVideoId: true, videoId: trimmed };
    }
    // Safe enum / flow type strings
    if (trimmed.startsWith('MDE_FLOW_') || trimmed.startsWith('VIDEO_TYPE_')) {
      return { type: 'string', value: trimmed };
    }
    return { type: 'string', length: obj.length };
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return { type: typeof obj, value: obj };
  }

  if (Array.isArray(obj)) {
    return {
      type: 'array',
      length: obj.length,
      sampleItems: obj.slice(0, 3).map((item) => analyzeJsonStructure(item, depth + 1))
    };
  }

  if (typeof obj === 'object') {
    const struct: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        struct[key] = '[REDACTED]';
      } else {
        struct[key] = analyzeJsonStructure(value, depth + 1);
      }
    }
    return { type: 'object', properties: struct };
  }

  return { type: typeof obj };
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
 * Sanitizes headers, strictly ensuring no sensitive headers (Authorization, Cookie, SAPISID) are exposed.
 */
export function filterSafeHeaders(
  headers: Headers | Record<string, string> | null | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  const processHeader = (key: string, value: string) => {
    const lowerKey = key.toLowerCase().trim();
    if (SAFE_HEADER_NAMES.has(lowerKey)) {
      result[lowerKey] = sanitizeStringValue(value);
    } else if (SENSITIVE_KEY_REGEX.test(lowerKey)) {
      result[lowerKey] = '[REDACTED]';
    } else {
      result[lowerKey] = '[Header present]';
    }
  };

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => processHeader(key, value));
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) processHeader(k, String(v));
  } else if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) processHeader(k, String(v));
  }

  return result;
}

/**
 * Safely parses and redacts request bodies (JSON, FormData, URLSearchParams, text).
 */
export function parseAndSanitizeBody(
  rawBody: any,
  contentType: string
): { sanitizedBody: any; bodyType: BodyRepresentationType; structuralAnalysis?: any } {
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

  // Handle String Body (JSON or Text)
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          sanitizedBody: redactSensitiveData(parsed),
          bodyType: 'json',
          structuralAnalysis: analyzeJsonStructure(parsed)
        };
      } catch {
        // Fall through to text
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
      } catch {}
    }

    return { sanitizedBody: sanitizeStringValue(trimmed), bodyType: 'text' };
  }

  // Handle Object Body
  if (typeof rawBody === 'object') {
    return {
      sanitizedBody: redactSensitiveData(rawBody),
      bodyType: 'json',
      structuralAnalysis: analyzeJsonStructure(rawBody)
    };
  }

  return { sanitizedBody: '[Binary or unsupported body format]', bodyType: 'binary/unsupported' };
}
