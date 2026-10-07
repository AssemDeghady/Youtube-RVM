# YouTube Related Video Manager

A local-first browser extension created to help creators bulk link their YouTube Shorts to long-form videos, directly through their existing YouTube Studio session.

## Why this exists

If you create YouTube Shorts to point viewers toward your deep-dive videos, you probably know the pain: you can attach a Related Video to a Short, but YouTube only lets you do it manually, one single video at a time.

For anyone managing dozens or hundreds of Shorts, that means hours of repetitive clicking. To make matters worse, Google's official YouTube Data API v3 does not expose the Related Video property anywhere in its endpoints.

YouTube RVM was born to solve that. The goal is simple: an open-source, community-driven tool that handles bulk linking right inside your browser, without any middleman.

## Our design principles

Everything in this project is built around privacy, simplicity, and keeping complete control in your hands.

• Local first: Everything runs on your machine inside your browser. There is no remote backend, no external database, and no cloud server collecting your data.

• No API keys or Google Cloud setup: You do not need a developer account, API quotas, or complex OAuth verification screens. The extension simply uses your already-signed-in YouTube Studio tab.

• Complete privacy: We never ask for your Google password, we never touch your session cookies, and we never scrape account credentials.

• Free and open source forever: No subscriptions, no locked tiers, and no hidden telemetry.

## Current status: Shorts List View MVP

The extension now operates directly from the YouTube Studio Shorts List View:
studio.youtube.com/channel/.../videos/short

Creators can select multiple Shorts using YouTube Studio's own table checkboxes, paste one target video URL or ID, and assign the Related Video to all selected Shorts sequentially without ever opening individual video details pages.

## Project overview

```
youtube_rvm/
  dist/                  Compiled extension ready to load into Chrome
  public/                Manifest and icon assets
  scripts/build.mjs      Vite build script producing self-contained bundles
  scripts/test.mjs       Automated unit test suite
  src/
    common/              Filters, YouTube URL normalizer, and sensitive data redactor
    content/             Studio detector, selection tracker, and panel UI
    interceptor/         MAIN-world fetch observer and sequential mutation executor
    types/               Shared TypeScript interfaces
  package.json           Dependencies and build scripts
  tsconfig.json          Strict TypeScript configuration
```

## Getting started

You will need Node.js (version 18 or newer) and npm installed on your computer.

1. Clone this repository to your machine.

2. Install dependencies:
   npm install

3. Run automated tests:
   npm test

4. Build the extension:
   npm run build

If you want the bundler to automatically rebuild whenever you make changes to the source files, run:
   npm run watch

## Loading the extension into your browser

1. Open Google Chrome, Brave, Edge, or any Chromium-based browser.
2. Type chrome://extensions in your address bar and press Enter.
3. Turn on Developer mode using the toggle switch in the top right corner.
4. Click the Load unpacked button in the top left corner.
5. Choose the dist directory inside this project folder.
6. The extension is now active and ready.

## How to use the Shorts List View Assigner

1. Open studio.youtube.com in your browser while signed in.
2. Navigate to Content in the left menu, then switch to the Shorts tab.
3. In the bottom right corner, open the ShortLinker card. The Shorts Linker tab is active.
4. Select one or more Shorts using YouTube Studio's regular table checkboxes.
5. Paste any target video into the Related Video input box:
   • Regular watch link: https://www.youtube.com/watch?v=VIDEO_ID
   • Shortened link: https://youtu.be/VIDEO_ID
   • Shorts link: https://www.youtube.com/shorts/VIDEO_ID
   • Or raw 11-character video ID
6. Safety First: If you select 1 Short, click Test Update on this Short to verify that your active session accepts the update.
7. Once verified, select any number of Shorts and click Assign to Shorts.
8. The extension executes each update sequentially with a gentle delay, showing live per-video progress and a Stop button to pause at any time.

## Built-in safety precautions

The extension was engineered with strict guardrails:

• In-memory session execution: All updates are made through your browser session in the main page world. No credentials, cookies, or auth tokens are ever logged, stored, or sent across the bridge.

• Safe sequential processing: Mutations run one by one with a configurable pause between requests. We never fire simultaneous bulk requests that could overload your session.

• Deep automatic redaction: All sensitive keys such as tokens, auth hashes, cookies, and session strings are recursively replaced with redacted placeholders in all diagnostic views.

• In-memory only: Captured requests live in browser memory during your session. Nothing is ever written to disk, local storage, or external logs.

## Contributing

Whether you are a creator testing this on your channel or an engineer looking to help with bulk queuing and UI design, your feedback is warmly welcomed. Feel free to open an issue or start a discussion.
