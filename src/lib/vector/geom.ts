export function detectCorners(
  points: Pt[],
  thresholdDeg: number,
  window: number,
  closed: boolean,
): boolean[] {
  const n = points.length;
  const flags = new Array<boolean>(n).fill(false);
  if (n < 5) return flags;
  const w = Math.max(1, Math.min(window, Math.floor(n / 3)));
  const th = (thresholdDeg * Math.PI) / 180;
  const ang = new Float64Array(n); // প্রতিটা পয়েন্টে turning angle

  for (let i = 0; i < n; i++) {
    if (!closed && (i - w < 0 || i + w > n - 1)) continue;
    const a = points[(i - w + n) % n];
    const b = points[i];
    const c = points[(i + w) % n];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 0.4 || l2 < 0.4) continue;
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    ang[i] = Math.acos(Math.max(-1, Math.min(1, cos)));
  }

  for (let i = 0; i < n; i++) {
    if (ang[i] < th) continue;
    let isMax = true;
    for (let k = -w; k <= w && isMax; k++) {
      if (k === 0) continue;
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      // সমান হলে বাঁ দিকেরটা জেতে, তাই প্রতি কোণায় ঠিক একটাই corner
      if (ang[j] > ang[i] || (ang[j] === ang[i] && k < 0)) isMax = false;
    }
    if (isMax) flags[i] = true;
  }
  return flags;
}
