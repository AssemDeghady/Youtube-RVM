import { NavigationChangeCallback } from '../types';
import { getStudioContext, logStudioDiagnostics } from './detector';

export class StudioNavigationObserver {
  private currentUrl: string;
  private callbacks: NavigationChangeCallback[] = [];
  private pollIntervalId: number | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor() {
    this.currentUrl = window.location.href;
  }

  /**
   * Registers a callback to be invoked on SPA or full navigation.
   */
  public onNavigate(cb: NavigationChangeCallback): void {
    this.callbacks.push(cb);
  }

  /**
   * Starts listening for navigation events.
   */
  public start(): void {
    const handlePotentialNavigation = (reason: string) => {
      if (window.location.href !== this.currentUrl) {
        this.currentUrl = window.location.href;
        const context = getStudioContext();
        logStudioDiagnostics(context, `SPA Navigation (${reason})`);
        for (const cb of this.callbacks) {
          try {
            cb(context);
          } catch (err) {
            console.error('[ShortLinker POC] Error in navigation callback:', err);
          }
        }
      }
    };

    // 1. YouTube specific custom events (dispatched on document / window)
    const ytEvents = ['yt-navigate-finish', 'yt-page-data-updated'];
    for (const evtName of ytEvents) {
      document.addEventListener(evtName, () => handlePotentialNavigation(`Event: ${evtName}`), true);
      window.addEventListener(evtName, () => handlePotentialNavigation(`Event: ${evtName}`), true);
    }

    // 2. Browser history popstate & hashchange
    window.addEventListener('popstate', () => handlePotentialNavigation('popstate'), true);
    window.addEventListener('hashchange', () => handlePotentialNavigation('hashchange'), true);

    // 3. Fallback URL polling to guarantee detection of in-page pushState / replaceState
    this.pollIntervalId = window.setInterval(() => {
      handlePotentialNavigation('polling');
    }, 250);

    // 4. MutationObserver on document.head (YouTube Studio alters title and canonical links on navigation)
    this.mutationObserver = new MutationObserver(() => {
      handlePotentialNavigation('dom-mutation');
    });

    if (document.head) {
      this.mutationObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  public stop(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.callbacks = [];
  }
}
