export const aed = (n: number) =>
  `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (from: number, to: number) => (from === 0 ? 0 : ((to - from) / from) * 100);

export const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" fill="#e8edf3"/><text x="50%" y="50%" fill="#9aa7b5" font-family="Arial" font-size="22" text-anchor="middle">No image</text></svg>',
  );