import { isYouTubeStudio, getStudioContext, logStudioDiagnostics } from './detector';
import { StudioNavigationObserver } from './navigation';
import { DevIndicatorUI } from './ui';

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

function initializeShortLinkerPOC(): void {
  if (!isYouTubeStudio()) {
    return;
  }

  // Ensure MAIN-world interceptor is loaded
  try {
    ensureInterceptorInstalled();
  } catch (err) {
    console.warn('[ShortLinker POC] Could not run interceptor script tag injection fallback:', err);
  }

  const initialContext = getStudioContext();
  logStudioDiagnostics(initialContext, 'Extension Initialized');

  // Mount Dev UI
  const devUI = new DevIndicatorUI();

  // Ensure DOM is ready before mounting UI
  if (document.body) {
    devUI.mount(initialContext);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      devUI.mount(initialContext);
    });
  }

  // Initialize SPA Navigation Observer
  const navObserver = new StudioNavigationObserver();
  navObserver.onNavigate((newContext) => {
    devUI.updateContext(newContext);
  });
  navObserver.start();

  console.info(
    '%c[ShortLinker POC] Content script successfully loaded with Network Inspector support.',
    'color: #22c55e; font-weight: bold;'
  );
}

initializeShortLinkerPOC();
