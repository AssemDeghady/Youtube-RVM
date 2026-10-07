export type ErrorCategory =
  | 'invalid_argument'
  | 'network_error'
  | 'session_expired'
  | 'verification_rejected'
  | 'server_error'
  | 'cancelled'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  userMessage: string;
  technicalSummary?: string;
  isRetryable: boolean;
}

/**
 * Classifies raw network and YouTube Studio API errors into user-friendly messages.
 */
export function classifyError(
  rawError?: string,
  httpStatus?: number,
  attestationRejected?: boolean
): ClassifiedError {
  const errText = (rawError || '').toLowerCase();

  // 1. User Cancellation
  if (errText.includes('cancel') || errText.includes('operation stopped') || errText.includes('not attempted')) {
    return {
      category: 'cancelled',
      userMessage: 'Cancelled by user.',
      technicalSummary: rawError,
      isRetryable: true
    };
  }

  // 2. Attestation / Verification Rejection
  if (
    attestationRejected ||
    errText.includes('attestation') ||
    errText.includes('challenge') ||
    errText.includes('token rejected') ||
    errText.includes('botguard') ||
    errText.includes('integrity')
  ) {
    return {
      category: 'verification_rejected',
      userMessage: 'YouTube Studio did not accept this update for the current session. Please refresh Studio and try again.',
      technicalSummary: rawError || 'Verification challenge rejected',
      isRetryable: false
    };
  }

  // 3. Session / Authentication Expiration
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    errText.includes('unauthenticated') ||
    errText.includes('permission_denied') ||
    errText.includes('session expired') ||
    errText.includes('auth') ||
    errText.includes('login')
  ) {
    return {
      category: 'session_expired',
      userMessage: 'Your YouTube Studio session may have expired. Refresh Studio and try again.',
      technicalSummary: rawError || `HTTP ${httpStatus}`,
      isRetryable: false
    };
  }

  // 4. Invalid Argument / Invalid Values
  if (
    httpStatus === 400 ||
    errText.includes('invalid argument') ||
    errText.includes('invalid_argument') ||
    errText.includes('bad request') ||
    errText.includes('not found') ||
    errText.includes('invalid value') ||
    errText.includes('table-heade')
  ) {
    return {
      category: 'invalid_argument',
      userMessage: 'YouTube rejected this update because one of the supplied values was invalid.',
      technicalSummary: rawError || 'Invalid argument',
      isRetryable: true
    };
  }

  // 5. Network / Fetch Failures
  if (
    httpStatus === 0 ||
    errText.includes('network') ||
    errText.includes('fetch') ||
    errText.includes('failed to fetch') ||
    errText.includes('timeout') ||
    errText.includes('offline') ||
    errText.includes('connection')
  ) {
    return {
      category: 'network_error',
      userMessage: 'Could not reach YouTube. Check your connection and try again.',
      technicalSummary: rawError || 'Network failure',
      isRetryable: true
    };
  }

  // 6. YouTube Server Error (5xx)
  if ((httpStatus && httpStatus >= 500) || errText.includes('internal error') || errText.includes('server error')) {
    return {
      category: 'server_error',
      userMessage: 'YouTube Studio encountered an internal error. Please try again later.',
      technicalSummary: rawError || `HTTP ${httpStatus}`,
      isRetryable: true
    };
  }

  // 7. Unknown
  return {
    category: 'unknown',
    userMessage: 'An unexpected error occurred while updating this Short.',
    technicalSummary: rawError || (httpStatus ? `HTTP ${httpStatus}` : 'Unknown'),
    isRetryable: true
  };
}
