/**
 * Web Worker for SVG → PNG conversion using OffscreenCanvas.
 * Runs off the main thread to prevent jank during identicon rendering.
 */

const PNG_SIZE = 128;

async function svgToPng(svgString: string): Promise<string> {
  const canvas = new OffscreenCanvas(PNG_SIZE, PNG_SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get OffscreenCanvas context');

  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: PNG_SIZE,
    resizeHeight: PNG_SIZE,
  });

  ctx.clearRect(0, 0, PNG_SIZE, PNG_SIZE);
  ctx.drawImage(bitmap, 0, 0, PNG_SIZE, PNG_SIZE);
  bitmap.close();

  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await resultBlob.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );
  return `data:image/png;base64,${base64}`;
}

// Handle messages from the main thread
self.onmessage = async (e: MessageEvent<{ address: string; svg: string }>) => {
  const { address, svg } = e.data;
  try {
    const pngDataUri = await svgToPng(svg);
    self.postMessage({ address, pngDataUri, error: null });
  } catch (err) {
    self.postMessage({ address, pngDataUri: null, error: (err as Error).message });
  }
};
