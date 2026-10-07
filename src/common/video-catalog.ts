import type { TargetVideo } from '../types/index.ts';

export class VideoCatalogStore {
  private videosMap: Map<string, TargetVideo> = new Map();

  /**
   * Adds or updates a list of videos in the in-memory catalog.
   */
  public addVideos(videos: TargetVideo[]): number {
    let addedCount = 0;
    for (const v of videos) {
      if (v && v.id) {
        if (!this.videosMap.has(v.id)) {
          addedCount++;
        }
        this.videosMap.set(v.id, v);
      }
    }
    return addedCount;
  }

  /**
   * Returns a single video by ID if present.
   */
  public getById(id: string): TargetVideo | undefined {
    return this.videosMap.get(id);
  }

  /**
   * Returns all catalog videos.
   */
  public getAll(): TargetVideo[] {
    return Array.from(this.videosMap.values());
  }

  /**
   * Returns total count of videos in memory.
   */
  public count(): number {
    return this.videosMap.size;
  }

  /**
   * Clears the in-memory catalog.
   */
  public clear(): void {
    this.videosMap.clear();
  }

  /**
   * Searches the in-memory catalog by title or video ID.
   * Case-insensitive, returns up to limit results.
   */
  public search(query: string, limit = 50): TargetVideo[] {
    const trimmed = query.trim().toLowerCase();
    const all = Array.from(this.videosMap.values());

    if (!trimmed) {
      return all.slice(0, limit);
    }

    const matches: TargetVideo[] = [];
    for (const v of all) {
      const matchTitle = v.title.toLowerCase().includes(trimmed);
      const matchId = v.id.toLowerCase().includes(trimmed);

      if (matchTitle || matchId) {
        matches.push(v);
        if (matches.length >= limit) {
          break;
        }
      }
    }

    return matches;
  }

  /**
   * Fallback: extracts any creator videos currently visible in the DOM.
   */
  public extractFromDom(doc: Document = document): TargetVideo[] {
    const extracted: TargetVideo[] = [];
    const rows = doc.querySelectorAll('ytcp-video-row, ytcp-entity-row, [role="row"]');

    for (const row of Array.from(rows)) {
      const link = row.querySelector('a[href*="/video/"]');
      if (!link) continue;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/video\/([a-zA-Z0-9_-]{11})/);
      if (!match || !match[1]) continue;

      const id = match[1];
      const titleEl = row.querySelector('#video-title, .video-title, a#video-title');
      const title = titleEl?.textContent?.trim() || 'Untitled Video';

      const imgEl = row.querySelector('img#thumbnail, img') as HTMLImageElement | null;
      const thumbnailUrl = imgEl?.src || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

      const durationEl = row.querySelector('.badge-shape__label, .duration, ytcp-video-thumbnail .badge');
      const duration = durationEl?.textContent?.trim() || undefined;

      extracted.push({
        id,
        title,
        thumbnailUrl,
        duration
      });
    }

    if (extracted.length > 0) {
      this.addVideos(extracted);
    }

    return extracted;
  }
}
