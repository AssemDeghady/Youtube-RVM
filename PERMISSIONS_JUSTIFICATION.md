# Permissions Justification — ShortLinker

This document details the minimal permissions requested by **ShortLinker** in accordance with Chrome Web Store Single Purpose and Least Privilege policies.

---

## 1. Summary of Declared Permissions

```json
{
  "manifest_version": 3,
  "name": "ShortLinker — YouTube Shorts Related Video Manager",
  "version": "1.0.0",
  "permissions": [],
  "host_permissions": []
}
```

* **API Permissions:** `NONE` (Zero extension API permissions requested).
* **Host Permissions:** `NONE` (No broad host permissions requested).
* **Content Scripts:** Restricted strictly to `https://studio.youtube.com/*`.

---

## 2. Content Scripts Justification

### Match Pattern: `https://studio.youtube.com/*`

* **Why it is necessary:**
  ShortLinker is specifically designed to function within YouTube Studio. It injects a user interface onto the YouTube Studio Shorts listing page (`studio.youtube.com/channel/.../videos/short`) so that creators can select multiple Shorts and assign a Related Video in bulk.

* **World: `MAIN` (`interceptor.js` at `document_start`):**
  - YouTube Studio relies on client-side SPA navigation and internal XMLHttpRequest/Fetch network requests.
  - The MAIN world script passively observes the internal Studio video catalog responses to populate the Related Video selector and captures the authenticated mutation template in volatile memory when the creator manually saves a video.
  - When the user triggers bulk assignment, this script performs the sequential update requests using the page's existing same-origin authenticated session.
  - Crucially, running in the MAIN world allows the extension to leverage the browser's existing page session without requiring or accessing user cookies or sensitive credentials.

* **World: `ISOLATED` (`content.js` at `document_idle`):**
  - The isolated content script renders the non-intrusive floating control panel and target selector in the bottom-right corner of YouTube Studio.
  - It observes native checkbox selections on the Shorts table and communicates user intent with the MAIN world interceptor via standard DOM CustomEvents.

---

## 3. Web Accessible Resources Justification

```json
"web_accessible_resources": [
  {
    "resources": ["interceptor.js"],
    "matches": ["https://studio.youtube.com/*"]
  }
]
```

* **Why it is necessary:**
  Allows the extension to load `interceptor.js` in the context of `studio.youtube.com` as defined by Manifest V3 specifications.
* **Scope restriction:** Scoped strictly to `https://studio.youtube.com/*`. Cannot be accessed or embedded by any other origin.

---

## 4. Unnecessary Permissions Explicitly Omitted

1. **`cookies`:** OMITTED. ShortLinker does not read, extract, or manage browser cookies.
2. **`storage`:** OMITTED. ShortLinker does not persist any data across sessions.
3. **`tabs` / `activeTab`:** OMITTED. No tab querying or screenshot capabilities are needed.
4. **`webRequest` / `declarativeNetRequest`:** OMITTED. Network interaction is handled via client-side fetch in the page context.
5. **`<all_urls>`:** OMITTED. The extension only executes on `studio.youtube.com`.

---

## 5. Compliance Statement

ShortLinker adheres to Google's Developer Program Policies, specifically:
- **Single Purpose Policy:** The extension serves one single, clear purpose: bulk-assigning Related Videos to YouTube Shorts in YouTube Studio.
- **Minimum Permissions:** It requests zero special browser permissions and limits its content scripts exclusively to the target domain (`studio.youtube.com`).
