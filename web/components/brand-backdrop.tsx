/** Deep-navy background with soft blue shapes, used behind the landing hero and its closing call to action. */
export function BrandBackdrop({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative isolate overflow-hidden bg-navy text-white ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-[12%] -top-[20%] h-[85%] w-[55%] rounded-[45%_55%_60%_40%/50%_45%_55%_50%] bg-navy-deep/80" />
        <div className="absolute left-[38%] -top-[35%] h-[90%] w-[60%] rotate-12 rounded-[60%_40%_50%_50%/45%_55%_45%_55%] bg-navy-2/80" />
        <div className="absolute -right-[10%] top-[10%] h-[70%] w-[30%] rounded-[50%_50%_40%_60%/60%_40%_60%_40%] bg-brand-700/35 blur-2xl" />
        <div className="absolute -left-[8%] bottom-[-25%] h-[55%] w-[28%] rounded-[55%_45%_50%_50%/50%_60%_40%_50%] bg-brand-500/25 blur-2xl" />
      </div>
      {children}
    </div>
  );
}

/**
 * A night skyline of glass towers drawn in SVG (no photographs: the app renders offline), for the
 * sign-in panel — the design reference's building photo, in the brand's own palette.
 */
export function Skyline({ className = "" }: { className?: string }) {
  const towers = [
    { x: 0, w: 70, h: 210 },
    { x: 78, w: 96, h: 330 },
    { x: 182, w: 64, h: 250 },
    { x: 254, w: 120, h: 420 },
    { x: 382, w: 80, h: 290 },
    { x: 470, w: 60, h: 200 },
  ];
  const H = 440;
  return (
    <svg viewBox={`0 0 530 ${H}`} preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <defs>
        <linearGradient id="tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4192" />
          <stop offset="1" stopColor="#1b1e50" />
        </linearGradient>
        <pattern id="windows" width="12" height="14" patternUnits="userSpaceOnUse">
          <rect x="3" y="3" width="6" height="8" rx="1" fill="#6f80ff" opacity="0.22" />
        </pattern>
      </defs>
      {towers.map((t, i) => (
        <g key={i}>
          <rect x={t.x} y={H - t.h} width={t.w} height={t.h} fill="url(#tower)" />
          <rect x={t.x + 6} y={H - t.h + 12} width={t.w - 12} height={t.h - 12} fill="url(#windows)" />
          <rect x={t.x} y={H - t.h} width={t.w} height={2} fill="#7d8cff" opacity="0.5" />
        </g>
      ))}
    </svg>
  );
}
