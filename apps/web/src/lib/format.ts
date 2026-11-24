export const aed = (n: number) =>
  `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (from: number, to: number) => (from === 0 ? 0 : ((to - from) / from) * 100);

export const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" fill="#e8edf3"/><text x="50%" y="50%" fill="#9aa7b5" font-family="Arial" font-size="22" text-anchor="middle">No image</text></svg>',
  );
  
/** { whole: "1,299", cents: "00" } so prices can be styled Amazon-style (big whole part, small cents). */
export const priceParts = (n: number) => {
  const [w, c] = n.toFixed(2).split('.');
  return { whole: Number(w).toLocaleString('en-US'), cents: c };
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}