/**
 * Detects and tracks selected Shorts rows in YouTube Studio's list view.
 * Maps: YouTube list row -> selected checkbox -> video ID.
 */

import { isValidYouTubeVideoId } from '../common/youtube';

const VIDEO_ID_REGEX = /\/video\/([a-zA-Z0-9_-]{11})/;

export type SelectionChangeCallback = (selectedVideoIds: string[]) => void;

export class ShortsSelectionTracker {
  private selectedIds: Set<string> = new Set();
  private callbacks: SelectionChangeCallback[] = [];
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private isListening = false;

  constructor() {
    this.handleDomEvent = this.handleDomEvent.bind(this);
  }

  /**
   * Scans the current DOM to detect all currently selected Short video IDs.
   */
  public scanSelectedVideoIds(): string[] {
    const foundIds = new Set<string>();

    // Strategy 1: Inspect all row containers (excluding table headers)
    const rows = document.querySelectorAll(
      'ytcp-video-row, ytcp-entity-row, [role="row"], .ytcp-video-row'
    );

    for (const row of Array.from(rows)) {
      // Exclude header rows completely
      if (
        row.closest('ytcp-table-header, ytcp-video-section-header, thead') ||
        row.matches('ytcp-table-header, ytcp-table-header *, thead, [role="columnheader"]')
      ) {
        continue;
      }

      // Check if this row's checkbox is selected
      const checkbox = row.querySelector(
        'ytcp-checkbox, ytcp-checkbox-lit, input[type="checkbox"], [role="checkbox"]'
      );

      const isChecked =
        checkbox?.getAttribute('aria-checked') === 'true' ||
        (checkbox as any)?.checked === true ||
        checkbox?.hasAttribute('checked') ||
        row.classList.contains('selected') ||
        row.hasAttribute('selected') ||
        row.getAttribute('aria-selected') === 'true';

      if (isChecked) {
        const videoId = this.extractVideoIdFromRow(row);
        if (videoId && isValidYouTubeVideoId(videoId)) {
          foundIds.add(videoId);
        }
      }
    }

    // Strategy 2: Inspect all elements with checked status directly
    const checkedElements = document.querySelectorAll(
      '[aria-checked="true"], input[type="checkbox"]:checked, ytcp-checkbox[checked], ytcp-checkbox-lit[checked]'
    );

    for (const el of Array.from(checkedElements)) {
      // Ignore header "Select All" checkbox when searching for individual video IDs
      if (el.closest('ytcp-table-header, ytcp-video-section-header, thead, [role="columnheader"]')) {
        continue;
      }
      const row = el.closest('ytcp-video-row, [role="row"], ytcp-entity-row, .table-row');
      if (row && !row.closest('ytcp-table-header, ytcp-video-section-header, thead')) {
        const videoId = this.extractVideoIdFromRow(row);
        if (videoId && isValidYouTubeVideoId(videoId)) {
          foundIds.add(videoId);
        }
      }
    }

    return Array.from(foundIds);
  }

  /**
   * Extracts the genuine 11-char video ID from a row element.
   */
  public extractVideoIdFromRow(row: Element): string | null {
    // Immediately reject any header element
    if (
      row.closest('ytcp-table-header, ytcp-video-section-header, thead') ||
      row.matches('ytcp-table-header, thead, [role="columnheader"]')
    ) {
      return null;
    }

    // 1. Link with /video/<id>/...
    const links = row.querySelectorAll('a[href*="/video/"]');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') || '';
      const match = href.match(VIDEO_ID_REGEX);
      if (match && match[1] && isValidYouTubeVideoId(match[1])) {
        return match[1];
      }
    }

    // 2. Data attributes on row
    const attrId =
      row.getAttribute('video-id') ||
      row.getAttribute('data-video-id') ||
      (row as HTMLElement).dataset?.videoId;

    if (attrId && isValidYouTubeVideoId(attrId)) {
      return attrId;
    }

    // 3. ID attribute containing video ID pattern (strictly validated against false DOM IDs)
    const rowId = row.id || '';
    const idMatch = rowId.match(/([a-zA-Z0-9_-]{11})/);
    if (idMatch && idMatch[1] && isValidYouTubeVideoId(idMatch[1])) {
      return idMatch[1];
    }

    return null;
  }

  /**
   * Subscribes to selection changes.
   */
  public onSelectionChange(cb: SelectionChangeCallback): void {
    this.callbacks.push(cb);
  }

  public getSelectedVideoIds(): string[] {
    return Array.from(this.selectedIds);
  }

  /**
   * Starts tracking user clicks, checkbox changes, and table rerenders.
   */
  public start(): void {
    if (this.isListening) return;
    this.isListening = true;

    // Listen to user click / change events on table
    document.addEventListener('click', this.handleDomEvent, true);
    document.addEventListener('change', this.handleDomEvent, true);
    document.addEventListener('input', this.handleDomEvent, true);

    // Observe DOM mutations for table updates, virtualization, and sorting
    this.observer = new MutationObserver(() => {
      this.scheduleRescan();
    });

    if (document.body) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-checked', 'checked', 'selected', 'class']
      });
    }

    // Initial scan
    this.rescan();
  }

  public stop(): void {
    this.isListening = false;
    document.removeEventListener('click', this.handleDomEvent, true);
    document.removeEventListener('change', this.handleDomEvent, true);
    document.removeEventListener('input', this.handleDomEvent, true);

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.callbacks = [];
    this.selectedIds.clear();
  }

  private handleDomEvent(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Rescan if clicked/interacted with a checkbox or table row
    if (
      target.closest(
        'ytcp-checkbox, ytcp-checkbox-lit, input[type="checkbox"], ytcp-video-row, [role="row"], ytcp-table-header'
      )
    ) {
      this.scheduleRescan();
    }
  }

  private scheduleRescan(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.rescan();
    }, 60);
  }

  private rescan(): void {
    const newIds = this.scanSelectedVideoIds();
    const isDifferent =
      newIds.length !== this.selectedIds.size ||
      newIds.some((id) => !this.selectedIds.has(id));

    if (isDifferent) {
      this.selectedIds = new Set(newIds);
      for (const cb of this.callbacks) {
        try {
          cb(newIds);
        } catch (err) {
          console.error('[ShortLinker Selection] Error in selection callback:', err);
        }
      }
    }
  }
}
