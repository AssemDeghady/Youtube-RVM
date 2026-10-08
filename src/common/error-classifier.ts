export type AutomationErrorCategory =
  | 'navigation_timeout'
  | 'editor_not_found'
  | 'related_video_not_found'
  | 'picker_open_failed'
  | 'target_not_found'
  | 'selection_failed'
  | 'save_button_not_ready'
  | 'save_failed'
  | 'save_timeout'
  | 'save_verification_failed'
  | 'studio_error'
  | 'session_expired'
  | 'invalid_argument'
  | 'rate_limit'
  | 'network_error'
  | 'cancelled'
  | 'unknown';

export type ErrorCategory = AutomationErrorCategory;

export interface ClassifiedError {
  category: AutomationErrorCategory;
  userMessage: string;
  technicalSummary?: string;
  isRetryable: boolean;
}

const FRIENDLY_MESSAGES: Record<AutomationErrorCategory, string> = {
  navigation_timeout: 'Studio took too long to open this Short.',
  editor_not_found: 'Could not load the Short editor.',
  related_video_not_found: 'Could not find the Related video control.',
  picker_open_failed: "Could not open Studio's video picker.",
  target_not_found: 'The selected Related Video could not be found in Studio.',
  selection_failed: 'Studio did not accept the Related Video selection.',
  save_button_not_ready: 'Studio did not make the Save button ready.',
  save_failed: 'YouTube Studio rejected this update. No further changes were made to this Short.',
  save_timeout: 'Studio took too long to save this Short.',
  save_verification_failed: 'Studio reported a save, but the Related Video could not be verified.',
  studio_error: 'YouTube Studio rejected this update. No further changes were made to this Short.',
  session_expired: 'ShortLinker could not use the current YouTube Studio session. Please refresh Studio and perform one Related Video save manually, then try again.',
  invalid_argument: 'This item could not be identified as a YouTube video. It was skipped for safety.',
  rate_limit: 'Studio rate limit reached. Please wait a moment before trying again.',
  network_error: 'YouTube Studio could not be reached. Please check your connection and try again.',
  cancelled: 'Cancelled by user.',
  unknown: 'YouTube Studio did not accept this update for the current session.'
};

/**
 * Creates a classified error directly from an automation error category.
 */
export function createAutomationError(
  category: AutomationErrorCategory,
  technicalSummary?: string
): ClassifiedError {
  const isRetryable =
    category === 'navigation_timeout' ||
    category === 'picker_open_failed' ||
    category === 'save_timeout' ||
    category === 'save_button_not_ready' ||
    category === 'studio_error' ||
    category === 'rate_limit' ||
    category === 'network_error' ||
    category === 'unknown';

  return {
    category,
    userMessage: FRIENDLY_MESSAGES[category] || FRIENDLY_MESSAGES.unknown,
    technicalSummary,
    isRetryable
  };
}

/**
 * Classifies raw network, UI, or text errors into friendly messages.
 * Uses structured HTTP/API status where available.
 */
export function classifyError(
  rawError?: string,
  httpStatus?: number,
  _attestationRejected?: boolean
): ClassifiedError {
  const errText = (rawError || '').toLowerCase().trim();

  // Explicit user cancellation
  if (
    errText.includes('cancel') ||
    errText.includes('operation stopped') ||
    errText.includes('not attempted')
  ) {
    return createAutomationError('cancelled', rawError);
  }

  // Exact known category names
  if (errText in FRIENDLY_MESSAGES) {
    return createAutomationError(errText as AutomationErrorCategory, rawError);
  }

  // Structured HTTP status checks
  if (httpStatus === 401 || httpStatus === 403 || _attestationRejected) {
    return createAutomationError('session_expired', rawError || `HTTP ${httpStatus}`);
  }
  if (httpStatus === 429) {
    return createAutomationError('rate_limit', rawError || `HTTP 429`);
  }
  if (httpStatus && httpStatus >= 500) {
    return createAutomationError('studio_error', rawError || `HTTP ${httpStatus}`);
  }

  // Keyword-based classification
  if (errText.includes('invalid argument') || errText.includes('invalid video id')) {
    return createAutomationError('invalid_argument', rawError);
  }
  if (errText.includes('network') || errText.includes('fetch exception') || errText.includes('failed to fetch')) {
    return createAutomationError('network_error', rawError);
  }
  if (errText.includes('navigation') || errText.includes('navigating')) {
    return createAutomationError('navigation_timeout', rawError);
  }
  if (errText.includes('editor not found') || errText.includes('expected short')) {
    return createAutomationError('editor_not_found', rawError);
  }
  if (errText.includes('related video control') || errText.includes('related_video')) {
    return createAutomationError('related_video_not_found', rawError);
  }
  if (errText.includes('picker')) {
    return createAutomationError('picker_open_failed', rawError);
  }
  if (errText.includes('target not found') || errText.includes('could not be found')) {
    return createAutomationError('target_not_found', rawError);
  }
  if (errText.includes('selection')) {
    return createAutomationError('selection_failed', rawError);
  }
  if (errText.includes('save button')) {
    return createAutomationError('save_button_not_ready', rawError);
  }
  if (errText.includes('save timeout') || errText.includes('took too long to save')) {
    return createAutomationError('save_timeout', rawError);
  }
  if (errText.includes('verification') || errText.includes('verified')) {
    return createAutomationError('save_verification_failed', rawError);
  }
  if (errText.includes('save failed') || errText.includes('could not save')) {
    return createAutomationError('save_failed', rawError);
  }

  return createAutomationError('unknown', rawError || (httpStatus ? `HTTP ${httpStatus}` : undefined));
}
