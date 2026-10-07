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

## Current status: Production Grade Shorts Bulk Assigner

The extension operates directly from the YouTube Studio Shorts List View:
studio.youtube.com/channel/.../videos/short

Creators can:
1. Select one or more Shorts using YouTube Studio's own table checkboxes.
2. Click Select Related Video to open a searchable picker containing their channel's videos.
3. Search instantly by title or video ID.
4. Pick any target video, which displays with its title and thumbnail.
5. Review the clear confirmation modal before starting any bulk action.
6. Watch live progress with an animated progress bar and per-video status indicators.
7. Stop the queue at any moment with clean accounting that never marks unreached items as failed.
8. If any updates fail, view creator-friendly error reasons and retry only the failed items with one click.
9. Copy failed video IDs to clipboard for easy tracking.
10. Access advanced diagnostics and network inspection tucked neatly behind a collapsible toggle.

## Project overview

```
youtube_rvm/
  dist/                  Compiled extension ready to load into Chrome
  public/                Manifest and icon assets
  scripts/build.mjs      Vite build script producing self-contained bundles
  scripts/test.mjs       Automated unit test suite covering picker & mutation flows
  src/
    common/              Filters, catalog parser, in-memory store, URL normalizer
    content/             Studio detector, selection tracker, and picker panel UI
    interceptor/         MAIN-world fetch observer, catalog loader, and executor
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

## How to use the Bulk Video Assigner

1. Open studio.youtube.com in your browser while signed in.
2. Navigate to Content in the left menu, then switch to the Shorts tab.
3. In the bottom right corner, open the ShortLinker card.
4. Select one or more Shorts using YouTube Studio's table checkboxes.
5. Under Related Video, click Select Related Video.
6. A searchable picker opens showing your channel's videos:
   • Type in the search box to filter instantly by title or video ID
   • Click any video to select it as the target Related Video
   • The picker closes, and your selected video's title and thumbnail are shown
7. Optional Fallback: If you ever need to link a video not listed, click "Or enter YouTube URL / ID manually" to paste a link directly.
8. Click Assign to Selected Shorts to open the Confirmation dialog.
9. Review the confirmation details and click Start Assignment.
10. The extension executes each update sequentially with a gentle delay, displaying a live progress bar and per-video status.
11. You can click Stop at any time to pause the queue.
12. When finished, if any Shorts encountered issues, click Retry Failed to run only the failed items, or click Copy Failed IDs to copy them.

## Built-in safety precautions

The extension was engineered with strict guardrails:

• In-memory session execution: All updates are made through your browser session in the main page world. No credentials, cookies, or auth tokens are ever logged, stored, or sent across the bridge.

• Safe sequential processing: Mutations run one by one with a configurable pause between requests. We never fire simultaneous bulk requests that could overload your session.

• Deep automatic redaction: All sensitive keys such as tokens, auth hashes, cookies, and session strings are recursively replaced with redacted placeholders in all diagnostic views.

• In-memory only: Captured requests and video catalogs live in browser memory during your session. Nothing is ever written to disk, local storage, or external logs.

## Contributing

Whether you are a creator testing this on your channel or an engineer looking to help with bulk queuing and UI design, your feedback is warmly welcomed. Feel free to open an issue or start a discussion.
