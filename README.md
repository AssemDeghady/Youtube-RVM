# ShortLinker — YouTube Shorts Related Video Manager

ShortLinker is an open-source Chrome/Chromium extension (Manifest V3) that bulk-assigns a **Related Video** to multiple YouTube Shorts directly from the YouTube Studio Shorts listing page (`studio.youtube.com/channel/.../videos/short`).

By operating entirely within the listing page, ShortLinker updates dozens of Shorts in seconds without navigating through individual video editors.

---

## Features

- **Listing-Page Bulk Operations:** Apply changes to 30+ Shorts at once directly from the Shorts table. No editor page loads, no tab juggling.
- **Native Selection Integration:** Automatically detects Shorts selected using YouTube Studio's standard checkboxes.
- **Smart Target Video Picker:** Select from your channel's recent videos or paste any YouTube video link/ID.
- **Sequential Execution & Safety:** Applies updates sequentially with adjustable delays (800ms default) to respect YouTube Studio rate limits.
- **Live Progress & Stop Control:** Real-time progress bar with per-item status, instant cancel/stop button, and one-click retry for failed items.
- **Zero Credential Persistence:** Operates strictly within your authenticated browser session. No passwords, tokens, or cookies are ever stored, exported, or transmitted externally.

---

## Workflow

1. **Open YouTube Studio:** Navigate to **Content** &rarr; **Shorts** on [YouTube Studio](https://studio.youtube.com).
2. **One-Time Calibration:** Open any Short in Studio, set a Related Video, and click **Save**. ShortLinker captures the active session request template in volatile memory.
3. **Select Shorts:** Return to the Shorts listing page and check the boxes next to the Shorts you want to update.
4. **Choose Target Video:** In the ShortLinker panel, pick a video from the channel catalog or paste any YouTube video link.
5. **Apply:** Click **Apply to Selected Shorts**. ShortLinker updates each Short sequentially from the listing page.
6. **Review Results:** Monitor progress in real time. If needed, click **Retry Failed** to reprocess any items that encountered a temporary error.

---

## Quick Start

### Prerequisites

- **Node.js** (v18 or higher)
- **npm**
- Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser

### Build

```bash
# Clone the repository
git clone https://github.com/AssemDeghady/Youtube-RVM.git
cd Youtube-RVM

# Install dependencies
npm install

# Compile production build (outputs to dist/)
npm run build
```

To create a production distribution ZIP for the Chrome Web Store:
```bash
npm run package
```
This produces `release/ShortLinker-v1.0.0.zip`.

### Run Automated Tests

```bash
npm test
```
Runs the automated test suite verifying video ID validation, header filtering, catalog search ranking, queue state machines, cancellation semantics, and payload sanitization.

### Install / Deploy

1. Open your Chromium browser and go to `chrome://extensions/`.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** (top-left corner).
4. Select the `dist/` directory inside this repository.
5. Navigate to [YouTube Studio](https://studio.youtube.com) &rarr; **Content** &rarr; **Shorts**.
6. The ShortLinker panel will appear in the bottom-right corner of the page.

---

## Security & Privacy Guarantees

- **No Credential Storage:** The extension never writes tokens, session keys, or credentials to `chrome.storage`, `localStorage`, or disk.
- **No `cookies` Permission:** The extension does not request the `cookies` permission in `manifest.json`.
- **Zero External Connections:** No analytics, no tracking, and no external backends. 100% of network traffic occurs exclusively between your browser and `studio.youtube.com`.
- **Volatile In-Memory Lifecycle:** The mutation template exists only in temporary JavaScript memory during the active tab session and is purged upon tab close or manual clear.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
