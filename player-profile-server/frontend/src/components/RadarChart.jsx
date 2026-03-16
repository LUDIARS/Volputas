const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 120;
const LABEL_OFFSET = 22;

export default function RadarChart({ dimensions = [], vector = [] }) {
  if (dimensions.length === 0 || vector.length === 0) {
    return <div className="empty-state">No analysis data yet</div>;
  }

  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;

  function polarToXY(index, value) {
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: CENTER + RADIUS * value * Math.cos(angle),
      y: CENTER + RADIUS * value * Math.sin(angle),
    };
  }

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];
  const gridLines = rings.map((r) => {
    const points = [];
    for (let i = 0; i < n; i++) {
      const p = polarToXY(i, r);
      points.push(`${p.x},${p.y}`);
    }
    return points.join(' ');
  });

  // Axis lines
  const axes = [];
  for (let i = 0; i < n; i++) {
    const p = polarToXY(i, 1);
    axes.push({ x2: p.x, y2: p.y });
  }

  // Data polygon
  const dataPoints = [];
  for (let i = 0; i < n; i++) {
    const val = vector[i] ?? 0;
    const p = polarToXY(i, val);
    dataPoints.push(`${p.x},${p.y}`);
  }

  // Labels
  const labels = dimensions.map((dim, i) => {
    const p = polarToXY(i, 1 + LABEL_OFFSET / RADIUS);
    const name = typeof dim === 'object' ? dim.name : dim;
    return { x: p.x, y: p.y, text: name };
  });

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid */}
      {gridLines.map((points, i) => (
        <polygon
          key={i}
          points={points}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="0.5"
        />
      ))}

      {/* Axes */}
      {axes.map((a, i) => (
        <line
          key={i}
          x1={CENTER} y1={CENTER}
          x2={a.x2} y2={a.y2}
          stroke="var(--color-border)"
          strokeWidth="0.5"
        />
      ))}

      {/* Data area */}
      <polygon
        points={dataPoints.join(' ')}
        fill="rgba(108, 99, 255, 0.25)"
        stroke="var(--color-primary)"
        strokeWidth="2"
      />

      {/* Data points */}
      {vector.map((val, i) => {
        const p = polarToXY(i, val ?? 0);
        return <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--color-primary)" />;
      })}

      {/* Labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x} y={l.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-muted)"
          fontSize="11"
          fontFamily="inherit"
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}
