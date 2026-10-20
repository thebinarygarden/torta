import QRCode from 'qrcode';

const QUIET = 2;

/**
 * A QR code, dark on light in both themes: some scanners can't read one
 * inverted. It repeats the text printed beside it, so screen readers skip it.
 */
export function Qr({ value, size = 180 }: { value: string; size?: number }) {
  const { size: n, data } = QRCode.create(value).modules;
  let d = '';
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    d += `M${(i % n) + QUIET} ${Math.floor(i / n) + QUIET}h1v1h-1z`;
  }
  const side = n + QUIET * 2;
  return (
    <svg
      className="tt-qr"
      data-theme="light"
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect width={side} height={side} />
      <path d={d} />
    </svg>
  );
}
