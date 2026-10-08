# Chrome Web Store Reviewer Notes — ShortLinker

Thank you for reviewing **ShortLinker — YouTube Shorts Related Video Manager**.

This guide provides step-by-step instructions for testing and verifying the extension within YouTube Studio.

---

## Prerequisites for Reviewers

- A standard Google / YouTube account with access to [YouTube Studio](https://studio.youtube.com).
- At least **2 YouTube Shorts** uploaded to the channel (public or unlisted).
- At least **1 video** available to assign as the Related Video.

---

## Step-by-Step Test Procedure

### Step 1: Install and Open YouTube Studio
1. Load the extension in Chrome (via `Load unpacked` pointing to `dist/`, or from the uploaded package).
2. Open Chrome and navigate to [https://studio.youtube.com/](https://studio.youtube.com/).
3. In the left navigation menu, click **Content**, then select the **Shorts** tab (`https://studio.youtube.com/channel/.../videos/short`).
4. You will see the **ShortLinker** widget appear in the bottom-right corner with a status badge.

### Step 2: One-Time Session Calibration
1. Click on any Short in your table to open its standard YouTube Studio editor page.
2. In the right-hand sidebar, locate the native **Related video** field.
3. Select any video from the picker and click YouTube Studio's blue **Save** button.
4. Click the back arrow to return to the **Content → Shorts** listing page.
5. In the ShortLinker widget, notice the status badge turns green: **"Studio Session: Connected"** and **"Template: Active"**.

### Step 3: Select Multiple Shorts
1. On the Shorts listing page, click the checkboxes next to 2 or more Shorts.
2. The ShortLinker widget immediately detects the selection and displays the count (e.g., *"2 Shorts selected"*).

### Step 4: Choose Target Related Video
1. In the ShortLinker panel, use the **Target Related Video** dropdown to pick a long-form video, or paste any valid YouTube video link into the manual input.
2. The selected target video title and ID will be highlighted in the panel.

### Step 5: Execute Bulk Assignment
1. Click the blue **Apply to Selected Shorts** button.
2. A confirmation modal will appear detailing the target video and the number of Shorts to update. Click **Confirm & Apply**.
3. Watch the sequential progress bar:
   - Updates are processed one-by-one directly from the listing page.
   - **No editor tabs or navigation loops** are triggered.
   - Per-item progress displays a checkmark as each item succeeds.
4. Upon completion, a summary card appears reporting: *"All done — X/X Shorts updated successfully."*

### Step 6: Test User Cancellation (Optional)
1. Select 5 or more Shorts and start the operation.
2. Click the red **Stop** button while the queue is running.
3. Notice that the currently executing request completes, subsequent items are marked as *"Not Attempted"*, and the queue stops gracefully without freezing or data loss.

---

## Technical & Security Verification

- **Network Traffic:** Open DevTools Network tab. You will see requests are made exclusively to `https://studio.youtube.com/youtubei/v1/video_manager/metadata_update`. No requests are made to any third-party domain or external backend.
- **Console Hygiene:** Open DevTools Console tab. No verbose debug logs or sensitive credentials (such as cookies or SAPISID tokens) are emitted.
- **Storage Verification:** Open DevTools Application tab &rarr; Storage. Verify that `chrome.storage`, `localStorage`, and `IndexedDB` contain zero authentication tokens or persistent state from ShortLinker.

---

## Contact

If you have any questions or require additional information, please feel free to reach out via the Chrome Web Store Developer Console or through the GitHub repository issues.
