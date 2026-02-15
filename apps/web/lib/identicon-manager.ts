import { createIdenticon } from 'identicons-esm';

const PNG_SIZE = 128;
const LRU_MAX = 500;

/**
 * LRU cache for identicon data URIs.
 * Evicts least-recently-used entries when capacity is exceeded.
 */
class LRUCache<V> {
  private map = new Map<string, V>();
  constructor(private capacity: number) {}

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, val: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict oldest (first entry)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, val);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}

type NodeUpdateCallback = (address: string, pngDataUri: string) => void;

/**
 * Manages identicon generation and SVG→PNG conversion.
 * Uses a Web Worker for off-thread PNG conversion with LRU caching.
 */
class IdenticonManager {
  private svgCache = new LRUCache<string>(LRU_MAX);
  private pngCache = new LRUCache<string>(LRU_MAX);
  private pending = new Set<string>();
  private worker: Worker | null = null;
  private workerSupported = true;
  private onNodeUpdate: NodeUpdateCallback | null = null;

  // Fallback: main-thread canvas conversion
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;

  setNodeUpdateCallback(cb: NodeUpdateCallback | null): void {
    this.onNodeUpdate = cb;
  }

  private getWorker(): Worker | null {
    if (!this.workerSupported) return null;
    if (this.worker) return this.worker;

    try {
      this.worker = new Worker(
        new URL('./identicon-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e: MessageEvent<{ address: string; pngDataUri: string | null; error: string | null }>) => {
        const { address, pngDataUri } = e.data;
        this.pending.delete(address);
        if (pngDataUri) {
          this.pngCache.set(address, pngDataUri);
          this.onNodeUpdate?.(address, pngDataUri);
        }
      };

      this.worker.onerror = () => {
        // OffscreenCanvas not supported or worker failed — use fallback
        this.workerSupported = false;
        this.worker = null;
      };

      return this.worker;
    } catch {
      this.workerSupported = false;
      return null;
    }
  }

  private async fallbackSvgToPng(svgString: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.fallbackCanvas) {
        this.fallbackCanvas = document.createElement('canvas');
        this.fallbackCanvas.width = PNG_SIZE;
        this.fallbackCanvas.height = PNG_SIZE;
        this.fallbackCtx = this.fallbackCanvas.getContext('2d');
      }

      if (!this.fallbackCtx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        this.fallbackCtx!.clearRect(0, 0, PNG_SIZE, PNG_SIZE);
        this.fallbackCtx!.drawImage(img, 0, 0, PNG_SIZE, PNG_SIZE);
        const pngDataUri = this.fallbackCanvas!.toDataURL('image/png');
        URL.revokeObjectURL(img.src);
        resolve(pngDataUri);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load SVG image'));
      };

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
      img.src = URL.createObjectURL(svgBlob);
    });
  }

  /**
   * Get identicon data URI for an address.
   * Returns PNG if cached, SVG fallback otherwise while kicking off async PNG conversion.
   */
  getIdenticonDataUri(address: string): string {
    const cleanAddress = address.replace(/\s/g, '');

    // Best: cached PNG
    const cachedPng = this.pngCache.get(cleanAddress);
    if (cachedPng) return cachedPng;

    // Good: cached SVG (start PNG conversion in background)
    const cachedSvg = this.svgCache.get(cleanAddress);
    if (cachedSvg !== undefined) {
      this.startPngConversion(cleanAddress, cachedSvg);
      return cachedSvg;
    }

    // Generate SVG
    try {
      const svg = createIdenticon(cleanAddress, { format: 'svg' });
      const sizedSvg = svg.replace('<svg ', `<svg width="${PNG_SIZE}" height="${PNG_SIZE}" `);
      const dataUri = 'data:image/svg+xml;base64,' + btoa(sizedSvg);
      this.svgCache.set(cleanAddress, dataUri);

      // Kick off async PNG conversion
      this.startPngConversion(cleanAddress, svg);

      return dataUri;
    } catch {
      return '';
    }
  }

  private startPngConversion(address: string, svgRaw: string): void {
    if (this.pending.has(address) || this.pngCache.has(address)) return;
    this.pending.add(address);

    // Ensure we have the raw SVG (not the data URI)
    const svg = svgRaw.startsWith('data:') ? '' : svgRaw;

    const worker = this.getWorker();
    if (worker && svg) {
      worker.postMessage({ address, svg });
      return;
    }

    // Fallback: main-thread conversion
    if (!svg) {
      // Need to regenerate SVG from address
      try {
        const rawSvg = createIdenticon(address, { format: 'svg' });
        this.doFallbackConversion(address, rawSvg);
      } catch {
        this.pending.delete(address);
      }
    } else {
      this.doFallbackConversion(address, svg);
    }
  }

  private async doFallbackConversion(address: string, svg: string): Promise<void> {
    try {
      const pngDataUri = await this.fallbackSvgToPng(svg);
      this.pngCache.set(address, pngDataUri);
      this.onNodeUpdate?.(address, pngDataUri);
    } catch {
      // Silently fail
    } finally {
      this.pending.delete(address);
    }
  }

  /**
   * Generate identicons only for visible nodes, skipping offscreen ones.
   * Prioritizes nodes without cached PNGs.
   */
  generateForViewport(visibleNodeIds: string[]): void {
    for (const id of visibleNodeIds) {
      const cleanId = id.replace(/\s/g, '');
      if (this.pngCache.has(cleanId)) continue;
      // This will generate SVG + kick off async PNG conversion
      this.getIdenticonDataUri(id);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.onNodeUpdate = null;
  }
}

/** Singleton identicon manager */
export const identiconManager = new IdenticonManager();
