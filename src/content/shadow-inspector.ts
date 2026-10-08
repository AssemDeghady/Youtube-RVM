/**
 * Shadow DOM Inspector & UI Element Discovery Engine
 * 
 * Safely inspects YouTube Studio's open ShadowRoots and reports element
 * detection evidence with strategy attribution without dumping raw HTML.
 */

import { DiagnosticDomSnapshot } from '../diagnostics/types';
import { findDeep, findAllDeep, queryDeep } from '../common/dom-traversal';

/**
 * Recursively generates a compact structural representation of open ShadowRoots.
 */
export function inspectStudioShadowTree(
  root: Element | Document | ShadowRoot = document.body,
  depth = 0,
  maxDepth = 6
): string {
  if (depth > maxDepth || !root) return '';

  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  const getElementLabel = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
    const aria = el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')?.slice(0, 30)}"]` : '';
    return `${tag}${id}${role}${aria}`;
  };

  // Inspect children of current root
  const elements = Array.from(root.children || []);

  for (const el of elements) {
    const label = getElementLabel(el);
    const isStudioComponent =
      label.startsWith('ytcp-') ||
      label.startsWith('tp-yt-') ||
      el.id.includes('video') ||
      el.id.includes('panel') ||
      el.id.includes('editor') ||
      el.id.includes('save') ||
      el.id.includes('picker');

    if (isStudioComponent || depth < 2) {
      lines.push(`${indent}└── ${label}`);

      if (el.shadowRoot) {
        lines.push(`${indent}    └── #shadow-root (open)`);
        const shadowOutput = inspectStudioShadowTree(el.shadowRoot, depth + 2, maxDepth);
        if (shadowOutput) {
          lines.push(shadowOutput);
        }
      } else {
        const childOutput = inspectStudioShadowTree(el, depth + 1, maxDepth);
        if (childOutput) {
          lines.push(childOutput);
        }
      }
    }
  }

  return lines.join('\n');
}

export interface UiElementCheckResult {
  name: string;
  found: boolean;
  strategy?: string;
  selectorUsed?: string;
  tag?: string;
  id?: string;
  visible?: boolean;
  enabled?: boolean;
  details?: string;
}

/**
 * Probes the Studio DOM for all required controls and reports the discovery strategy used.
 */
export function detectAllRequiredUiElements(): UiElementCheckResult[] {
  const results: UiElementCheckResult[] = [];

  const check = (
    name: string,
    probeFn: () => { el: Element | null; strategy: string; selector: string }
  ) => {
    try {
      const { el, strategy, selector } = probeFn();
      if (el) {
        const visible =
          el instanceof HTMLElement
            ? el.offsetParent !== null || window.getComputedStyle(el).display !== 'none'
            : true;
        const enabled = !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';

        results.push({
          name,
          found: true,
          strategy,
          selectorUsed: selector,
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          visible,
          enabled,
          details: (el.textContent || '').trim().slice(0, 100)
        });
      } else {
        results.push({
          name,
          found: false,
          strategy: 'none',
          selectorUsed: selector
        });
      }
    } catch {
      results.push({
        name,
        found: false,
        strategy: 'error'
      });
    }
  };

  // 1. Studio App
  check('Studio App', () => ({
    el: document.querySelector('ytcp-app, ytcp-home-app, body'),
    strategy: 'tag',
    selector: 'ytcp-app'
  }));

  // 2. Shorts Table
  check('Shorts Table', () => ({
    el: findDeep(document, 'ytcp-video-section, ytcp-table-header, [role="table"]'),
    strategy: 'shadow-dom traversal',
    selector: 'ytcp-video-section, ytcp-table-header'
  }));

  // 3. Selected Shorts Checkboxes
  check('Selected Shorts Checkbox', () => ({
    el: findDeep(document, 'ytcp-checkbox[checked], [aria-checked="true"], input[type="checkbox"]:checked'),
    strategy: 'aria-checked attribute',
    selector: 'ytcp-checkbox[checked], [aria-checked="true"]'
  }));

  // 4. Details Edit Link / Pencil
  check('Details Link', () => ({
    el: findDeep(document, 'a[href*="/video/"], [aria-label*="Details"]'),
    strategy: 'href pattern',
    selector: 'a[href*="/video/"]'
  }));

  // 5. Video Editor Section
  check('Video Editor', () => ({
    el: findDeep(document, 'ytcp-video-metadata-editor, ytcp-video-details-section, ytcp-animatable#side-panel'),
    strategy: 'shadow-dom traversal',
    selector: 'ytcp-video-metadata-editor'
  }));

  // 6. Related Video Card
  check('Related Video Card', () => {
    const el = queryDeep(document, (e) => {
      const tag = e.tagName.toLowerCase();
      if (tag === 'ytcp-video-metadata-shorts-related-video') return true;
      const text = e.textContent || '';
      return text.includes('Related video') && (tag.startsWith('ytcp-') || e.id.includes('related'));
    });
    return {
      el,
      strategy: 'text-content & tag',
      selector: 'ytcp-video-metadata-shorts-related-video, text("Related video")'
    };
  });

  // 7. Related Video Picker Button
  check('Related Video Button', () => ({
    el:
      findDeep(document, '#related-video-picker-button, [aria-label*="Related video"]') ||
      queryDeep(document, (e) => {
        const text = (e.textContent || '').toLowerCase();
        const isBtn = e.tagName === 'BUTTON' || e.tagName.startsWith('YTCP-BUTTON');
        return isBtn && (text.includes('choose video') || text.includes('related'));
      }),
    strategy: 'aria-label & text-content',
    selector: '#related-video-picker-button, text("choose video")'
  }));

  // 8. Picker Dialog
  check('Picker Dialog', () => ({
    el: findDeep(document, 'ytcp-video-picker-dialog, ytcp-dialog[role="dialog"], [role="dialog"]'),
    strategy: 'role attribute & tag',
    selector: 'ytcp-video-picker-dialog, [role="dialog"]'
  }));

  // 9. Picker Search Field
  check('Picker Search Field', () => ({
    el: findDeep(document, '#search-input, input[type="search"], input#query-input, input[type="text"]'),
    strategy: 'input type & id',
    selector: '#search-input, input[type="search"]'
  }));

  // 10. Target Video Rows in Picker
  check('Target Video Rows', () => ({
    el: findDeep(document, 'ytcp-video-list-cell, ytcp-entity-row, ytcp-video-row, [role="row"]'),
    strategy: 'row role & component tag',
    selector: 'ytcp-video-list-cell, ytcp-entity-row'
  }));

  // 11. Native Save Button
  check('Save Button', () => ({
    el: findDeep(document, '#save-button, ytcp-button#save-button, button[aria-label="Save"]'),
    strategy: 'id & aria-label',
    selector: '#save-button, button[aria-label="Save"]'
  }));

  // 12. Success Toast
  check('Success Toast', () => ({
    el: findDeep(document, 'ytcp-toast, tp-yt-paper-toast, [role="status"], #toast'),
    strategy: 'role & toast tag',
    selector: 'ytcp-toast, tp-yt-paper-toast'
  }));

  // 13. Error Toast
  check('Error Toast', () => {
    const el = queryDeep(document, (e) => {
      const tag = e.tagName.toLowerCase();
      if (tag === 'ytcp-toast' || tag === 'tp-yt-paper-toast' || e.getAttribute('role') === 'alert') {
        const text = (e.textContent || '').toLowerCase();
        return text.includes('error') || text.includes('failed') || text.includes('could not');
      }
      return false;
    });
    return {
      el,
      strategy: 'role=alert & text-content',
      selector: 'ytcp-toast[error], [role="alert"]'
    };
  });

  return results;
}

/**
 * Converts element check results into safe DiagnosticDomSnapshot records.
 */
export function createDomSnapshots(relativeTimeMs: number): DiagnosticDomSnapshot[] {
  const elements = detectAllRequiredUiElements();
  return elements.map((item) => ({
    timestamp: new Date().toLocaleTimeString(),
    relativeTimeMs,
    elementName: item.name,
    found: item.found,
    strategy: item.strategy,
    selectorUsed: item.selectorUsed,
    tag: item.tag,
    id: item.id,
    visible: item.visible,
    enabled: item.enabled,
    textSnippet: item.details
  }));
}
