import assert from 'node:assert';
import { normalizeYouTubeVideoId, buildRelatedVideoPayload } from '../src/common/youtube.ts';
import { formatDurationSeconds, parseCreatorVideosResponse } from '../src/common/catalog-parser.ts';
import { VideoCatalogStore } from '../src/common/video-catalog.ts';

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

console.log('\n[Test] All 12 test suites passed successfully (100% assertions verified)!');
