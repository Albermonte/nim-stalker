export function computeTxTimelinePositions(
  txs: Array<{ hash: string; from: string; to: string }>,
  focusAddress: string,
): Map<string, { x: number; y: number }> {
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

  const n = txs.length;
  const positions = new Map<string, { x: number; y: number }>();

  if (n === 0) return positions;

  const perRow = clamp(Math.round(Math.sqrt(n) * 1.6), 8, 24);
  const colGap = 220;
  const rowGap = 340;
  const laneOffset = 120;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const row = Math.floor(i / perRow);
    const col = i % perRow;

    const incoming = tx.to === focusAddress;
    const x = col * colGap;
    const y = row * rowGap + (incoming ? -laneOffset : laneOffset);

    positions.set(tx.hash, { x, y });

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Center around (0, 0) while preserving relative distances.
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (const [hash, pos] of positions) {
    positions.set(hash, { x: pos.x - midX, y: pos.y - midY });
  }

  return positions;
}
