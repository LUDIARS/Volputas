// Minimal SVG line chart for per-axis score history (design §5.3).
// series: [{ id, label, points: [{ t, score(0..1)|null }] }]
const WIDTH = 560;
const HEIGHT = 180;
const PADDING = { top: 12, right: 12, bottom: 24, left: 30 };
const COLORS = ['var(--color-primary)', 'var(--color-accent)', 'var(--color-danger)'];

export default function TrendChart({ series = [] }) {
  const drawable = series.filter((line) => line.points.filter((p) => p.score !== null).length >= 2);
  if (drawable.length === 0) {
    return <div className="empty-state">再分析を重ねると推移が表示されます。</div>;
  }

  const times = drawable.flatMap((line) => line.points.map((p) => Date.parse(p.t)));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = Math.max(1, maxT - minT);
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (t) => PADDING.left + ((Date.parse(t) - minT) / spanT) * plotW;
  const y = (score) => PADDING.top + (1 - score) * plotH;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto' }}>
        {[0, 0.5, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left} y1={y(tick)}
              x2={WIDTH - PADDING.right} y2={y(tick)}
              stroke="var(--color-border)" strokeWidth="0.5"
            />
            <text x={PADDING.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="central" fontSize="9" fill="var(--color-text-muted)">
              {Math.round(tick * 100)}
            </text>
          </g>
        ))}
        {drawable.map((line, index) => {
          const points = line.points.filter((p) => p.score !== null);
          return (
            <g key={line.id}>
              <polyline
                points={points.map((p) => `${x(p.t)},${y(p.score)}`).join(' ')}
                fill="none"
                stroke={COLORS[index % COLORS.length]}
                strokeWidth="2"
              />
              {points.map((p) => (
                <circle key={p.t} cx={x(p.t)} cy={y(p.score)} r="2.5" fill={COLORS[index % COLORS.length]} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="trend-legend">
        {drawable.map((line, index) => (
          <span key={line.id}>
            <i style={{ background: COLORS[index % COLORS.length] }} />
            {line.label}
          </span>
        ))}
      </div>
    </div>
  );
}
