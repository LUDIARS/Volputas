// Radar over arbitrary points. Each point: { label, value: 0..1 | null,
// confidence } — null values (insufficient evidence) render as a grey gap at
// the centre instead of pretending the score is zero.
const SIZE = 340;
const CENTER = SIZE / 2;
const RADIUS = 120;
const LABEL_OFFSET = 26;

const CONFIDENCE_COLORS = {
  high: 'var(--color-primary)',
  medium: 'var(--color-accent)',
  low: 'var(--color-text-muted)',
  insufficient: 'var(--color-border)',
};

export default function RadarChart({ points, dimensions = [], vector = [] }) {
  // Legacy call sites (12-dimension pages) pass dimensions/vector.
  const resolved = points ?? dimensions.map((dim, i) => ({
    label: typeof dim === 'object' ? dim.name : dim,
    value: vector[i] ?? 0,
    confidence: 'low',
  }));
  if (resolved.length === 0) {
    return <div className="empty-state">No analysis data yet</div>;
  }
  return <RadarSvg points={resolved} />;
}

function RadarSvg({ points }) {

  const n = points.length;
  const angleStep = (2 * Math.PI) / n;

  function polarToXY(index, value) {
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: CENTER + RADIUS * value * Math.cos(angle),
      y: CENTER + RADIUS * value * Math.sin(angle),
    };
  }

  const rings = [0.25, 0.5, 0.75, 1.0];
  const gridLines = rings.map((r) => points
    .map((_, i) => {
      const p = polarToXY(i, r);
      return `${p.x},${p.y}`;
    })
    .join(' '));

  const dataPoints = points.map((point, i) => polarToXY(i, point.value ?? 0));

  const labels = points.map((point, i) => {
    const p = polarToXY(i, 1 + LABEL_OFFSET / RADIUS);
    return { ...p, text: point.label, insufficient: point.confidence === 'insufficient' };
  });

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block', margin: '0 auto', width: '100%', maxWidth: SIZE }}>
      {gridLines.map((gridPoints, i) => (
        <polygon key={i} points={gridPoints} fill="none" stroke="var(--color-border)" strokeWidth="0.5" />
      ))}
      {points.map((_, i) => {
        const p = polarToXY(i, 1);
        return (
          <line key={i} x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} stroke="var(--color-border)" strokeWidth="0.5" />
        );
      })}
      <polygon
        points={dataPoints.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="rgba(108, 99, 255, 0.22)"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
      />
      {points.map((point, i) => {
        const p = dataPoints[i];
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill={CONFIDENCE_COLORS[point.confidence] || CONFIDENCE_COLORS.low}
          >
            <title>
              {point.label}: {point.value === null ? 'データ不足' : Math.round(point.value * 100)}
            </title>
          </circle>
        );
      })}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x} y={l.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill={l.insufficient ? 'var(--color-border)' : 'var(--color-text-muted)'}
          fontSize="9.5"
          fontFamily="inherit"
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}
