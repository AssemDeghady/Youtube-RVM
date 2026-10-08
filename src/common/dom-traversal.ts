/**
 * Deep Shadow DOM Traversal Utilities
 * 
 * Safely traverses through document trees and open ShadowRoots.
 */

export function findDeep(root: Element | Document | ShadowRoot, selector: string): Element | null {
  try {
    const direct = root.querySelector(selector);
    if (direct) return direct;
  } catch {}

  const children = root.querySelectorAll('*');
  for (const child of Array.from(children)) {
    if (child.shadowRoot) {
      const found = findDeep(child.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

export function findAllDeep(root: Element | Document | ShadowRoot, selector: string): Element[] {
  const results: Element[] = [];
  try {
    results.push(...Array.from(root.querySelectorAll(selector)));
  } catch {}

  const children = root.querySelectorAll('*');
  for (const child of Array.from(children)) {
    if (child.shadowRoot) {
      results.push(...findAllDeep(child.shadowRoot, selector));
    }
  }
  return results;
}

export function queryDeep(
  root: Element | Document | ShadowRoot,
  predicate: (el: Element) => boolean
): Element | null {
  const children = root.querySelectorAll('*');
  for (const child of Array.from(children)) {
    try {
      if (predicate(child)) return child;
    } catch {}
    if (child.shadowRoot) {
      const found = queryDeep(child.shadowRoot, predicate);
      if (found) return found;
    }
  }
  return null;
}
