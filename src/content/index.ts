import { isYouTubeStudio, getStudioContext } from './detector';
import { StudioNavigationObserver } from './navigation';
import { ShortsSelectionTracker } from './selection';
import { ShortLinkerUI } from './ui';

function ensureInterceptorInstalled(): void {
  // If not already injected by script tag, inject as fallback
  if (!document.querySelector('script[data-shortlinker-interceptor]')) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    script.dataset.shortlinkerInterceptor = 'true';
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
}

function initializeShortLinker(): void {
  if (!isYouTubeStudio()) {
    return;
  }

  // Ensure MAIN-world interceptor is loaded
  try {
    ensureInterceptorInstalled();
  } catch {}

  const initialContext = getStudioContext();

  // Mount UI
  const shortLinkerUI = new ShortLinkerUI();

  // Ensure DOM is ready before mounting UI
  if (document.body) {
    shortLinkerUI.mount(initialContext);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      shortLinkerUI.mount(initialContext);
    });
  }

  // Initialize Shorts list selection tracker
  const selectionTracker = new ShortsSelectionTracker();
  selectionTracker.onSelectionChange((selectedIds) => {
    shortLinkerUI.updateSelection(selectedIds);
  });
  selectionTracker.start();

  // Initialize SPA Navigation Observer
  const navObserver = new StudioNavigationObserver();
  navObserver.onNavigate((newContext) => {
    shortLinkerUI.updateContext(newContext);
    // Trigger fresh selection scan after route transition
    setTimeout(() => {
      const ids = selectionTracker.scanSelectedVideoIds();
      shortLinkerUI.updateSelection(ids);
    }, 200);
  });
  navObserver.start();
}

initializeShortLinker();
