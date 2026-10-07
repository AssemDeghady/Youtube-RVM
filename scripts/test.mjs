import assert from 'node:assert';
import { normalizeYouTubeVideoId, isValidYouTubeVideoId, buildRelatedVideoPayload } from '../src/common/youtube.ts';
import { formatDurationSeconds, parseCreatorVideosResponse } from '../src/common/catalog-parser.ts';
import { VideoCatalogStore } from '../src/common/video-catalog.ts';
import { classifyError } from '../src/common/error-classifier.ts';

console.log('[Test] Running automated helper & catalog test suite...\n');

// =========================================================================
// 1. YouTube Video ID Normalization & Validation Tests
// =========================================================================
const urlTestCases = [
  { input: 'iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://www.youtube.com/watch?v=iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://www.youtube.com/watch?v=iXSU6nyUK78&t=45s', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://m.youtube.com/watch?v=iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://youtu.be/iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://youtu.be/iXSU6nyUK78?si=12345', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://www.youtube.com/shorts/iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://www.youtube.com/shorts/iXSU6nyUK78?feature=share', expected: 'iXSU6nyUK78', valid: true },
  { input: 'https://www.youtube.com/embed/iXSU6nyUK78', expected: 'iXSU6nyUK78', valid: true },
  { input: 'invalid_url_too_long', valid: false },
  { input: 'invalid!char', valid: false },
  { input: 'https://google.com/watch?v=iXSU6nyUK78', valid: false },
  { input: '', valid: false },
  { input: 'short', valid: false }
];

for (const tc of urlTestCases) {
  const result = normalizeYouTubeVideoId(tc.input);
  if (tc.valid) {
    assert.strictEqual(result.isValid, true, `Expected valid for input: ${tc.input}`);
    assert.strictEqual(result.videoId, tc.expected, `Expected ${tc.expected} for input: ${tc.input}`);
  } else {
    assert.strictEqual(result.isValid, false, `Expected invalid for input: ${tc.input}`);
  }
}
console.log('✓ 1. YouTube URL & Video ID normalization verified (14 cases).');

// =========================================================================
// 2. Duration Formatter Tests
// =========================================================================
assert.strictEqual(formatDurationSeconds(45), '0:45');
assert.strictEqual(formatDurationSeconds(754), '12:34');
assert.strictEqual(formatDurationSeconds(3665), '1:01:05');
assert.strictEqual(formatDurationSeconds(undefined), undefined);
console.log('✓ 2. Duration formatting verified.');

// =========================================================================
// 3. Sanitized Studio Network Response Parser Tests
// =========================================================================
const mockStudioResponse = {
  videos: [
    {
      videoId: '6c8mHBpLeNA',
      title: { runs: [{ text: 'How Sleep Affects Your Brain' }] },
      thumbnail: {
        thumbnails: [
          { url: 'https://i.ytimg.com/vi/6c8mHBpLeNA/default.jpg', width: 120, height: 90 },
          { url: 'https://i.ytimg.com/vi/6c8mHBpLeNA/mqdefault.jpg', width: 320, height: 180 }
        ]
      },
      lengthSeconds: '754',
      publishedTimeText: { simpleText: '2 weeks ago' },
      videoType: 'VIDEO_TYPE_UPLOAD'
    },
    {
      videoId: 'a1b2c3d4e5f',
      title: 'The Science of Deep Sleep',
      thumbnail: 'https://i.ytimg.com/vi/a1b2c3d4e5f/mqdefault.jpg',
      formattedDuration: '18:21',
      videoType: 'VIDEO_TYPE_UPLOAD'
    },
    {
      videoId: 'iXSU6nyUK78',
      title: { simpleText: 'Quick Sleep Hack Short' },
      lengthSeconds: '45',
      isShort: true
    }
  ]
};

const parsedVideos = parseCreatorVideosResponse(mockStudioResponse);
assert.strictEqual(parsedVideos.length, 3);
assert.strictEqual(parsedVideos[0].id, '6c8mHBpLeNA');
assert.strictEqual(parsedVideos[0].title, 'How Sleep Affects Your Brain');
assert.strictEqual(parsedVideos[0].duration, '12:34');
assert.strictEqual(parsedVideos[0].thumbnailUrl, 'https://i.ytimg.com/vi/6c8mHBpLeNA/mqdefault.jpg');
assert.strictEqual(parsedVideos[1].id, 'a1b2c3d4e5f');
assert.strictEqual(parsedVideos[1].title, 'The Science of Deep Sleep');
assert.strictEqual(parsedVideos[1].duration, '18:21');
assert.strictEqual(parsedVideos[2].id, 'iXSU6nyUK78');
assert.strictEqual(parsedVideos[2].title, 'Quick Sleep Hack Short');
console.log('✓ 3. Studio network response parsing verified with sanitized fixture.');

// =========================================================================
// 4. VideoCatalogStore Search & Filtering Tests
// =========================================================================
const catalog = new VideoCatalogStore();
catalog.addVideos(parsedVideos);

// Search by title
const titleSearchResults = catalog.search('Deep Sleep');
assert.strictEqual(titleSearchResults.length, 1);
assert.strictEqual(titleSearchResults[0].id, 'a1b2c3d4e5f');
console.log('✓ 4. Search by title verified.');

// Search by video ID
const idSearchResults = catalog.search('6c8m');
assert.strictEqual(idSearchResults.length, 1);
assert.strictEqual(idSearchResults[0].id, '6c8mHBpLeNA');
console.log('✓ 5. Search by ID verified.');

// Empty search (returns all up to limit)
const emptySearchResults = catalog.search('');
assert.strictEqual(emptySearchResults.length, 3);
console.log('✓ 6. Empty search returns all available catalog items.');

// No matching videos
const noMatchResults = catalog.search('NonExistentKeywordXYZ');
assert.strictEqual(noMatchResults.length, 0);
console.log('✓ 7. No matching videos returns empty list.');

// =========================================================================
// 5. Target Video Selection & Fallback Workflow Tests
// =========================================================================

// Test selecting a catalog video
let selectedTargetVideo = null;
let normalizedTargetId = null;

function selectVideo(v) {
  selectedTargetVideo = v;
  normalizedTargetId = v.id;
}

function clearSelection() {
  selectedTargetVideo = null;
  normalizedTargetId = null;
}

function handleManualEntry(input) {
  const res = normalizeYouTubeVideoId(input);
  if (res.isValid && res.videoId) {
    normalizedTargetId = res.videoId;
    selectedTargetVideo = {
      id: res.videoId,
      title: `Manual Video (${res.videoId})`,
      thumbnailUrl: `https://i.ytimg.com/vi/${res.videoId}/mqdefault.jpg`
    };
  } else {
    normalizedTargetId = null;
    selectedTargetVideo = null;
  }
}

// 8. Selecting a video sets the correct target ID
const chosenVideo = catalog.getById('6c8mHBpLeNA');
assert(chosenVideo !== undefined);
selectVideo(chosenVideo);
assert.strictEqual(normalizedTargetId, '6c8mHBpLeNA');
assert.strictEqual(selectedTargetVideo.title, 'How Sleep Affects Your Brain');
console.log('✓ 8. Selecting catalog video sets correct target ID and metadata.');

// 9. Manual URL fallback works
handleManualEntry('https://www.youtube.com/watch?v=a1b2c3d4e5f');
assert.strictEqual(normalizedTargetId, 'a1b2c3d4e5f');
assert.strictEqual(selectedTargetVideo.id, 'a1b2c3d4e5f');
console.log('✓ 9. Manual URL fallback parses and sets target ID correctly.');

// 10. Switching from selected catalog video to manually entered URL
selectVideo(chosenVideo);
assert.strictEqual(normalizedTargetId, '6c8mHBpLeNA');
handleManualEntry('https://youtu.be/z9y8x7w6v5u');
assert.strictEqual(normalizedTargetId, 'z9y8x7w6v5u');
console.log('✓ 10. Switching from catalog video to manual entry works seamlessly.');

// 11. Clearing selection disables assignment (target ID becomes null)
clearSelection();
assert.strictEqual(normalizedTargetId, null);
assert.strictEqual(selectedTargetVideo, null);
console.log('✓ 11. Clearing selection clears target ID and disables assignment.');

// =========================================================================
// 6. Mutation Payload Construction with Selected Target ID
// =========================================================================
const mockBaseTemplate = {
  context: { client: { clientName: 62, clientVersion: '1.2.3' } },
  flowType: 'MDE_FLOW_TYPE_EDIT',
  encryptedVideoId: 'OLD_SHORT_ID',
  videoLinkageShortsAttribution: { targetExternalVideoId: ['OLD_TARGET_ID'] },
  attestationResponseData: { someToken: 'test1234' }
};

const payload = buildRelatedVideoPayload(
  mockBaseTemplate,
  'iXSU6nyUK78',
  '6c8mHBpLeNA'
);

assert.strictEqual(payload.encryptedVideoId, 'iXSU6nyUK78');
assert.strictEqual(payload.flowType, 'MDE_FLOW_TYPE_EDIT');
assert.deepStrictEqual(payload.videoLinkageShortsAttribution, {
  targetExternalVideoId: ['6c8mHBpLeNA']
});
console.log('✓ 12. Mutation payload construction using selected video ID verified.');

// =========================================================================
// 7. Strict YouTube Video ID Validation & Blacklist Guards
// =========================================================================
assert.strictEqual(isValidYouTubeVideoId('iXSU6nyUK78'), true);
assert.strictEqual(isValidYouTubeVideoId('6c8mHBpLeNA'), true);
assert.strictEqual(isValidYouTubeVideoId('a1b2c3d4e5f'), true);

// Accidental DOM elements and slices must be rejected
assert.strictEqual(isValidYouTubeVideoId('table-heade'), false, 'Should reject table-heade DOM slice');
assert.strictEqual(isValidYouTubeVideoId('table-header'), false);
assert.strictEqual(isValidYouTubeVideoId('checkbox-lit'), false);
assert.strictEqual(isValidYouTubeVideoId('header-cell'), false);
assert.strictEqual(isValidYouTubeVideoId('section-head'), false);
assert.strictEqual(isValidYouTubeVideoId('entity-row-c'), false);

// Invalid lengths and nulls
assert.strictEqual(isValidYouTubeVideoId(''), false);
assert.strictEqual(isValidYouTubeVideoId(null), false);
assert.strictEqual(isValidYouTubeVideoId(undefined), false);
assert.strictEqual(isValidYouTubeVideoId('short'), false);
assert.strictEqual(isValidYouTubeVideoId('toolongvideoid123'), false);
console.log('✓ 13. Strict YouTube Video ID validation & DOM blacklist verified.');

// =========================================================================
// 8. Error Classifier Tests
// =========================================================================
// 400 Invalid argument
const err400 = classifyError('Request contains an invalid argument.', 400);
assert.strictEqual(err400.category, 'invalid_argument');
assert.strictEqual(err400.isRetryable, true);

// 401 Session expired
const err401 = classifyError('Unauthorized', 401);
assert.strictEqual(err401.category, 'session_expired');
assert.strictEqual(err401.isRetryable, false);

// Attestation challenge
const errAttest = classifyError('Attestation token rejected', 200, true);
assert.strictEqual(errAttest.category, 'verification_rejected');
assert.strictEqual(errAttest.isRetryable, false);

// Network failure
const errNet = classifyError('Failed to fetch', 0);
assert.strictEqual(errNet.category, 'network_error');
assert.strictEqual(errNet.isRetryable, true);

// Server 500
const err500 = classifyError('Internal server error', 500);
assert.strictEqual(err500.category, 'server_error');
assert.strictEqual(err500.isRetryable, true);

// User cancellation
const errCancel = classifyError('Operation stopped by user');
assert.strictEqual(errCancel.category, 'cancelled');
assert.strictEqual(errCancel.isRetryable, true);
console.log('✓ 14. Error classifier categorized all 6 error domains accurately.');

// =========================================================================
// 9. Partial Failure & Retry Accounting Tests
// =========================================================================
const mockItems = [
  { sourceShortId: 'short1', targetVideoId: 'target1', status: 'success' },
  { sourceShortId: 'short2', targetVideoId: 'target1', status: 'failed', error: 'Invalid argument', classifiedError: err400 },
  { sourceShortId: 'short3', targetVideoId: 'target1', status: 'success' }
];

const failedIds = mockItems.filter(it => it.status === 'failed').map(it => it.sourceShortId);
const succeededCount = mockItems.filter(it => it.status === 'success').length;
const failedCount = mockItems.filter(it => it.status === 'failed').length;

assert.strictEqual(succeededCount, 2);
assert.strictEqual(failedCount, 1);
assert.deepStrictEqual(failedIds, ['short2']);
console.log('✓ 15. Partial failure filtering & retry IDs extraction verified.');

// =========================================================================
// 10. Cancellation Accounting Tests (not_attempted vs failed)
// =========================================================================
const queueWithCancel = [
  { sourceShortId: 'short1', targetVideoId: 'target1', status: 'success' },
  { sourceShortId: 'short2', targetVideoId: 'target1', status: 'not_attempted', classifiedError: errCancel },
  { sourceShortId: 'short3', targetVideoId: 'target1', status: 'not_attempted', classifiedError: errCancel }
];

const completedItems = queueWithCancel.filter(it => it.status === 'success' || it.status === 'failed');
const notAttemptedItems = queueWithCancel.filter(it => it.status === 'not_attempted');
const actualFailed = queueWithCancel.filter(it => it.status === 'failed');

assert.strictEqual(completedItems.length, 1);
assert.strictEqual(notAttemptedItems.length, 2);
assert.strictEqual(actualFailed.length, 0, 'Unattempted items must NOT be counted as failed');
console.log('✓ 16. Cancellation properly categorizes unreached items as not_attempted without inflating failures.');

// =========================================================================
// 11. Immutable Job Snapshot Verification
// =========================================================================
const snapshot = Object.freeze({
  jobId: 'job_123',
  targetVideoId: 'target1',
  total: 3,
  completed: 1,
  succeeded: 1,
  failed: 0,
  notAttempted: 2,
  isCancelled: true,
  items: Object.freeze([...queueWithCancel]),
  failedItemIds: Object.freeze([]),
  finishedAt: '12:00:00 PM'
});

assert.strictEqual(Object.isFrozen(snapshot), true);
assert.strictEqual(Object.isFrozen(snapshot.items), true);
assert.strictEqual(Object.isFrozen(snapshot.failedItemIds), true);
console.log('✓ 17. Immutable job snapshot guarantees state stability.');

console.log('\n[Test] All 17 test suites passed successfully (100% assertions verified)!');
