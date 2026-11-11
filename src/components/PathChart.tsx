import type { TracePoint } from '@/sense/types';

interface Series {
  points: TracePoint[];
  color: string;
  label: string;
  dashed?: boolean;
  step?: boolean;
}

/** Small, quiet line chart for session summaries (SVG, no library). */
export function PathChart({ series, height = 120, unit }: { series: Series[]; height?: number; unit?: string }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return null;
  const width = 560;
  const pad = { l: 34, r: 8, t: 10, b: 20 };
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let v0 = Math.min(...all.map((p) => p.v));
  let v1 = Math.max(...all.map((p) => p.v));
  if (v1 - v0 < 2) {
    v0 -= 1;
    v1 += 1;
  }
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - v0) / (v1 - v0)) * (height - pad.t - pad.b);

  const path = (s: Series) => {
    const pts = [...s.points].sort((a, b) => a.t - b.t);
    if (s.step) pts.push({ t: t1, v: pts[pts.length - 1].v });
    return pts
      .map((p, i) => {
        if (i === 0) return `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
        if (s.step) return `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`;
        return `L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      })
      .join('');
  };

  const minutes = (t1 - t0) / 60_000;

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(' and ')}>
        <text x={4} y={pad.t + 8} className="fill-muted-foreground text-[10px]">
          {v1.toFixed(0)}
        </text>
        <text x={4} y={height - pad.b} className="fill-muted-foreground text-[10px]">
          {v0.toFixed(0)}
        </text>
        <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} className="stroke-white/10" />
        <text x={width - pad.r} y={height - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {minutes.toFixed(1)} min
        </text>
        {series.map((s) =>
          s.points.length > 1 ? (
            <path
              key={s.label}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 5' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.label}
            {unit ? ` (${unit})` : ''}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
