# Privacy Policy for ShortLinker

**Last updated:** October 8, 2026

ShortLinker ("we", "our", or "the extension") is a browser extension developed to assist YouTube creators in bulk-assigning Related Videos to YouTube Shorts directly within YouTube Studio. We are deeply committed to protecting creator privacy and safeguarding personal data.

---

## 1. Zero Data Collection Policy

ShortLinker adheres to a strict **zero data collection** principle:
- **No Personal Identifiable Information (PII):** We do not collect, store, sell, or transmit names, email addresses, channel passwords, IP addresses, or account identities.
- **No Credentials or Authentication Tokens:** The extension never requests, reads, stores, or extracts user passwords, OAuth credentials, Google account cookies, or session authentication tokens to persistent storage (such as `chrome.storage`, `localStorage`, or IndexedDB).
- **No Analytics or Telemetry:** The extension contains zero tracking scripts, analytics SDKs, advertising beacons, or telemetry instrumentation.
- **No External Servers:** The extension has no backend server. 100% of network communication happens locally between your web browser and official Google/YouTube Studio servers (`studio.youtube.com`).

---

## 2. In-Memory Session Operation

To perform bulk updates on your behalf, ShortLinker observes the standard network request structure of an authenticated save performed within your own YouTube Studio session.

- **Volatile Execution Only:** This structural template is held strictly in volatile, ephemeral JavaScript memory in your active browser tab.
- **Automatic Purging:** When you refresh the page, close the browser tab, click "Purge Template", or exit the browser, this volatile memory is immediately and permanently destroyed.
- **No Third-Party Transmission:** No session data, video data, or network headers are ever transmitted outside of your direct browser session with `studio.youtube.com`.

---

## 3. Chrome Extension Permissions

ShortLinker requests the minimum necessary permissions required to provide its core functionality:
- **Host Permissions / Content Scripts:** Restricted exclusively to `https://studio.youtube.com/*`. The extension cannot run or execute on any other website or domain.
- **Zero API Permissions:** The extension declares zero sensitive Chrome API permissions in its manifest (such as `cookies`, `webRequest`, `storage`, `tabs`, `management`, etc.).

---

## 4. Third-Party Services & Disclosure

ShortLinker does not share, transfer, or sell user data to any third-party organizations, data brokers, or advertising networks under any circumstances.

---

## 5. Security

The extension's source code is publicly accessible and open source. All updates are vetted against automated security linters and test suites to verify that sensitive request headers and parameters are redacted from local user interface logs.

---

## 6. Changes to this Policy

If any changes are made to this Privacy Policy, the updated policy will be posted in this repository and accompanied by an updated version number.

---

## 7. Contact Information

If you have questions, feedback, or concerns regarding this Privacy Policy, please open an issue on the official GitHub repository:
https://github.com/AssemDeghady/Youtube-RVM/issues
