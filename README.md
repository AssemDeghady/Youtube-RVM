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

## Current status: Research & Proof of Concept

Right now, this repository is in its initial discovery phase. Before we write any automation to update videos, we need to know the exact internal request structure YouTube Studio uses when saving a Related Video.

This repository provides a lightweight Manifest V3 development extension with an integrated passive network inspector. It runs cleanly on YouTube Studio, tracks single-page navigation, and lets developers capture the exact save payload with zero risk of modifying any account data.

## Project overview

```
youtube_rvm/
  dist/                  Compiled extension ready to load into Chrome
  public/                Manifest and icon assets
  scripts/build.mjs      Vite build script producing self-contained bundles
  src/
    common/              Filters, mutation recognition, and sensitive data redactor
    content/             Studio detector, navigation listener, and dev UI
    interceptor/         Passive fetch and XHR observer with in-memory replay
    types/               Shared TypeScript interfaces
  package.json           Dependencies and build scripts
  tsconfig.json          Strict TypeScript configuration
```

## Getting started

You will need Node.js (version 18 or newer) and npm installed on your computer.

1. Clone this repository to your machine.

2. Install dependencies:
   npm install

3. Build the extension:
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

## How to capture the Related Video save request

We need help capturing one real save request so we can map out the payload schema. Here is how you can do it in two minutes:

1. Open studio.youtube.com in your browser while signed in.
2. In the bottom right corner of the page, you will see a small dark card titled ShortLinker POC.
3. Click the Network Inspector tab on the card.
4. Navigate inside YouTube Studio to Content, switch to the Shorts tab, and click any Short to open its details editor.
5. Back on the ShortLinker card, click the blue Start Capture button. The status indicator will turn green.
6. In the YouTube editor, scroll down to the Related video field, pick any video, and click the blue SAVE button in the upper right corner of YouTube Studio.
7. Look at the ShortLinker card. You will see a new entry appear showing the captured endpoint and status.
8. Click the Copy JSON button on that card.
9. Click Stop Capture, and paste the copied snippet into our project discussion or issue tracker.

## Testing single-video replay

Once a Related Video mutation is captured during your session, the extension displays a green Related Video Mutation card showing the Source Short and the chosen Related Video target ID.

To verify whether your active browser session can reproduce the update without any third-party APIs:

1. On the ShortLinker card, locate the Related Video Mutation box.
2. Click the blue Test Replay button.
3. A confirmation dialog will appear explaining that this will replay the last captured Related Video update for the same Short and Related Video.
4. Click Replay to confirm.
5. The extension will perform the exact request in the main page context using your existing session.
6. You will immediately see the result displayed as either Success with HTTP 200 or Failed with the status code and sanitized error snippet.

## Built-in safety precautions

The network inspector was engineered with strict guardrails:

• Strictly passive: It wraps the browser's native network calls without touching or modifying any outgoing requests, headers, or responses.

• Deep automatic redaction: Before any request body is displayed or copied, all sensitive keys such as tokens, auth hashes, cookies, and session strings are recursively replaced with redacted placeholders.

• Safe headers only: Sensitive headers like Cookie and Authorization are stripped immediately. Only non-sensitive metadata such as Content-Type is displayed.

• In-memory only: Captured requests live in browser memory during your session. Nothing is ever written to disk, local storage, or external logs.

## Contributing

Whether you are a creator testing this on your channel or an engineer looking to help with bulk queuing and UI design, your feedback is warmly welcomed. Feel free to open an issue or start a discussion.
