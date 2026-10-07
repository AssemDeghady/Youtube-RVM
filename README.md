# YouTube Studio Related Video — ShortLinker POC

A minimal Manifest V3 Chrome extension technical proof-of-concept for detecting and passively observing YouTube Studio network mutations to reverse-engineer the YouTube Shorts "Related video" link operation.

---

## 🎯 Architecture & Safety Guarantees

This project operates strictly local-first and read-only:
- **No Backend / Server:** Operates entirely within the user's browser.
- **No Database:** In-memory data only; zero data persistence.
- **No YouTube Data API:** No Google Cloud credentials or API keys (the YouTube Data API v3 does not support the Shorts Related Video link).
- **No OAuth Flow:** Operates inside the user's existing authenticated YouTube Studio browser session.
- **No Credential Scraping:** Never touches passwords, cookies, or auth tokens.
- **Strictly Passive Interception:** Monkey-patches `window.fetch` and `XMLHttpRequest` in the MAIN world to observe requests **without altering** any URLs, headers, bodies, credentials, or responses.
- **No Video Modification:** Does not alter any video data or trigger mutations automatically.

---

## 📁 Project Structure

```
youtube_rvm/
├── dist/                          # Production build output (load this folder into Chrome)
│   ├── content.js                 # Standalone isolated-world content script (UI & SPA detector)
│   ├── content.js.map             # Content script source map
│   ├── interceptor.js             # Standalone MAIN-world passive network observer
│   ├── interceptor.js.map         # Interceptor script source map
│   ├── icons/                     # Extension icons (16px, 48px, 128px)
│   └── manifest.json              # Manifest V3 extension configuration
├── public/
│   ├── icons/                     # Extension icons
│   └── manifest.json              # Source Manifest V3 configuration
├── scripts/
│   └── build.mjs                  # Programmatic Vite multi-target build script
├── src/
│   ├── common/
│   │   ├── filter.ts              # Conservative endpoint keyword filtering
│   │   └── sanitizer.ts           # Recursive sensitive data & token redactor
│   ├── content/
│   │   ├── detector.ts            # Studio URL & DOM context parser
│   │   ├── index.ts               # Isolated content script entry point
│   │   ├── navigation.ts          # SPA navigation observer
│   │   └── ui.ts                  # Shadow DOM development panel with Network Inspector
│   ├── interceptor/
│   │   └── index.ts               # MAIN-world passive fetch / XHR interceptor
│   └── types/
│       └── index.ts               # Shared TypeScript interfaces & bridge events
├── package.json                   # NPM configuration and scripts
├── tsconfig.json                  # TypeScript compiler settings
└── README.md                      # Documentation & instructions
```

---

## 🛠️ Build Instructions

### Prerequisites
- Node.js >= 18 (tested on Node v22.x)
- npm >= 9

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Extension
```bash
npm run build
```
This runs strict TypeScript type checking (`tsc --noEmit`) and compiles both `content.js` and `interceptor.js` into the `dist/` directory as self-contained IIFEs with source maps.

### 3. Watch Mode (Live development)
```bash
npm run watch
```

---

## 🧩 Loading & Reloading in Chrome / Chromium

1. Open Google Chrome or any Chromium-based browser (Brave, Edge).
2. Navigate to `chrome://extensions`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left corner, click **Load unpacked**.
5. Select the `dist/` folder:
   ```
   /home/assem/Desktop/Projects/youtube_rvm/dist
   ```
6. **To reload after code changes:**
   Click the circular reload button on the **ShortLinker POC - YouTube Studio Related Video** card in `chrome://extensions`, then refresh the YouTube Studio tab.

---

## 🔬 How the Network Inspector Works

### 1. Dual-World Architecture
- **MAIN World (`interceptor.js`):** Runs at `document_start` directly in the page's execution context. It passively wraps `window.fetch` and `XMLHttpRequest.prototype` to inspect outgoing request bodies. Calls to the original functions proceed unmodified and uninhibited.
- **Isolated World (`content.js`):** Runs the development UI in an isolated Shadow DOM container.
- **Communication Bridge:** When candidate requests are detected, the MAIN-world script redacts sensitive data and dispatches a sanitized DOM `CustomEvent` (`shortlinker-network-capture`) to the isolated world. A control event (`shortlinker-control-command`) allows the UI to toggle capture ON/OFF.
- **Duplicate Protection:** Uses `window.SHORTLINKER_NETWORK_INSPECTOR_INSTALLED` to prevent multiple interceptors during SPA transitions.

### 2. Security & Redaction Safeguards
- **Conservative Filtering:** Telemetry endpoints (`log_event`, `stats/playback`, `heartbeat`, etc.) and non-mutating requests are ignored. Only mutation candidates containing keywords (`youtubei`, `metadata`, `video`, `edit`, `save`, `mutation`) are captured.
- **Headers Redacted:** `Cookie`, `Authorization`, and `SAPISID` headers are strictly stripped. Only safe metadata (`content-type`, `x-youtube-client-name`, etc.) is retained.
- **Recursive Body Redaction:** Any fields matching `token`, `auth`, `authorization`, `cookie`, `cookies`, `sapisid`, `access_token`, `refresh_token`, `password`, `session`, or `credential` have their values replaced with `[REDACTED]` before passing to the UI or console.
- **In-Memory Only:** No data is written to `chrome.storage`, `localStorage`, or disk.

---

## 📋 Manual Procedure for Capturing the Related Video Request

Follow this exact procedure to capture the real mutation signature:

1. Open **[https://studio.youtube.com/](https://studio.youtube.com/)** in Chrome (ensure you are logged in).
2. Look at the bottom-right corner for the **ShortLinker POC** card.
3. Click the **Network Inspector** tab on the card.
4. Navigate in YouTube Studio:
   - Click **Content** in the left sidebar.
   - Switch to the **Shorts** tab.
   - Click on any Short to open its **Video details** editor (`https://studio.youtube.com/video/<VIDEO_ID>/edit`).
5. On the ShortLinker card under the **Network Inspector** tab:
   - Click **Start Capture** (the status pill will turn green: `Status: ON`).
6. In YouTube Studio's editor:
   - Scroll down to the **"Related video"** section.
   - Click to select or change a Related Video (choose any public video on your channel).
   - Click the blue **SAVE** button in the top-right corner of YouTube Studio.
7. Observe the ShortLinker Network Inspector card:
   - The captured candidate request will appear in the card list (e.g., `POST /youtubei/v1/video_manager/metadata_update` or similar).
   - The card displays the timestamp, HTTP method, response status, content type, and sanitized body.
8. Click the **"Copy JSON"** button on that captured request card.
9. Click **Stop Capture** on the ShortLinker card.

---

## 📤 What to Send Back for Analysis

Paste the copied JSON from the **Copy JSON** button into the chat. It will look like this:

```json
{
  "method": "POST",
  "url": "https://studio.youtube.com/youtubei/v1/video_manager/...",
  "pathname": "/youtubei/v1/video_manager/...",
  "contentType": "application/json",
  "status": 200,
  "safeHeaders": {
    "content-type": "application/json",
    "x-youtube-client-name": "...",
    "x-youtube-client-version": "..."
  },
  "sanitizedBody": {
    "context": { ... },
    ...
  }
}
```

This will reveal the exact mutation key and payload structure YouTube Studio requires to set a Short's Related Video!
