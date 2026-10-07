import assert from 'node:assert';
import { normalizeYouTubeVideoId, buildRelatedVideoPayload } from '../src/common/youtube.ts';

console.log('[Test] Running automated helper tests...');

// 1. YouTube Video ID Normalization Tests
const testCases = [
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

for (const tc of testCases) {
  const result = normalizeYouTubeVideoId(tc.input);
  if (tc.valid) {
    assert.strictEqual(result.isValid, true, `Expected valid for input: ${tc.input}`);
    assert.strictEqual(result.videoId, tc.expected, `Expected ${tc.expected} for input: ${tc.input}`);
  } else {
    assert.strictEqual(result.isValid, false, `Expected invalid for input: ${tc.input}`);
  }
}
console.log('✓ YouTube URL normalization tests passed (13 cases).');

// 2. Payload Construction Tests
const mockBaseTemplate = {
  context: { client: { clientName: 62, clientVersion: '1.2.3' } },
  flowType: 'MDE_FLOW_TYPE_EDIT',
  encryptedVideoId: 'OLD_SHORT_ID',
  videoLinkageShortsAttribution: { targetExternalVideoId: ['OLD_TARGET_ID'] },
  attestationResponseData: { someToken: 'test1234' }
};

const constructedPayload = buildRelatedVideoPayload(
  mockBaseTemplate,
  'NEW_SHORT_123',
  'NEW_TARGET_456'
);

assert.strictEqual(constructedPayload.encryptedVideoId, 'NEW_SHORT_123');
assert.strictEqual(constructedPayload.flowType, 'MDE_FLOW_TYPE_EDIT');
assert.deepStrictEqual(constructedPayload.videoLinkageShortsAttribution, {
  targetExternalVideoId: ['NEW_TARGET_456']
});
assert.strictEqual(constructedPayload.context.client.clientName, 62);
assert.strictEqual(constructedPayload.attestationResponseData.someToken, 'test1234');

// Ensure base template was not mutated
assert.strictEqual(mockBaseTemplate.encryptedVideoId, 'OLD_SHORT_ID');
console.log('✓ Related Video mutation payload construction tests passed.');

console.log('[Test] All unit tests completed successfully!');
