/**
 * Original Lumina mark: simplified "page with highlight" — not a third-party logo or font glyph.
 */
export default function LogoMark({ size = 40 }) {
  return (
    <svg
      className="logo-mark-svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
    >
      <rect className="logo-mark-svg__bg" width="32" height="32" rx="9" ry="9" />
      <g className="logo-mark-svg__fg">
        <rect x="7.5" y="9.5" width="11" height="2.25" rx="1.12" />
        <rect x="7.5" y="14.25" width="8" height="2.25" rx="1.12" />
        <rect x="7.5" y="19" width="10" height="2.25" rx="1.12" />
      </g>
      <rect
        className="logo-mark-svg__beam"
        x="19.5"
        y="8"
        width="5"
        height="16"
        rx="2.5"
      />
    </svg>
  );
}
