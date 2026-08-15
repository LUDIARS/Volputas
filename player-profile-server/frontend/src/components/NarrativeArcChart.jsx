// Mean narrative arc with a ±1σ band and each session as a thin line, on the
// normalized 0..100% progress axis (spec/feature/narrative-arc.md §UI). Same
// minimal-SVG idiom as TrendChart / CaptureTimelineView.
const WIDTH = 560;
const HEIGHT = 200;
const PADDING = { top: 14, right: 12, bottom: 28, left: 32 };

function pathFor(points) {
  // Breaks the line where a bin has no value instead of interpolating over it.
  let path = '';
  let open = false;
  for (const point of points) {
    if (point === null) { open = false; continue; }
    path += `${open ? 'L' : 'M'}${point[0]},${point[1]} `;
    open = true;
  }
  return path.trim();
}

/** @implements SPEC-NARRATIVE-ARC */
export default function NarrativeArcChart({ analysis }) {
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (position) => PADDING.left + position * plotW;
  const y = (valence) => PADDING.top + (1 - (valence + 2) / 4) * plotH;
  const bins = analysis.bins || [];

  const mean = pathFor(bins.map((bin) => (bin.valence === null ? null : [x(bin.position), y(bin.valence)])));
  const bandTop = bins.filter((bin) => bin.valence !== null)
    .map((bin) => `${x(bin.position)},${y(Math.min(bin.valence + (bin.valenceDeviation || 0), 2))}`);
  const bandBottom = bins.filter((bin) => bin.valence !== null)
    .map((bin) => `${x(bin.position)},${y(Math.max(bin.valence - (bin.valenceDeviation || 0), -2))}`)
    .reverse();

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="ナラティブアーク">
        {[-2, -1, 0, 1, 2].map((tick) => (
          <g key={tick}>
            <line x1={PADDING.left} y1={y(tick)} x2={WIDTH - PADDING.right} y2={y(tick)} stroke="var(--color-border)" strokeWidth={tick === 0 ? 1 : 0.5} />
            <text x={PADDING.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="central" fontSize="9" fill="var(--color-text-muted)">
              {tick > 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((position) => (
          <text key={position} x={x(position)} y={HEIGHT - PADDING.bottom + 14} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)">
            {Math.round(position * 100)}%
          </text>
        ))}
        {bandTop.length >= 2 && (
          <polygon points={[...bandTop, ...bandBottom].join(' ')} fill="var(--color-primary)" opacity="0.12" />
        )}
        {(analysis.sessions || []).map((session) => (
          <path
            key={session.recordId}
            d={pathFor(session.valence.map((valence, index) => (valence === null || !bins[index] ? null : [x(bins[index].position), y(valence)])))}
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="1"
            opacity="0.55"
          >
            <title>{session.sessionLabel || session.recordId}</title>
          </path>
        ))}
        {mean && <path d={mean} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" />}
        {analysis.peak && (
          <circle cx={x(analysis.peak.position)} cy={y(analysis.peak.valence)} r="4" fill="var(--color-accent)">
            <title>{`ピーク ${Math.round(analysis.peak.position * 100)}% / ${analysis.peak.valence}`}</title>
          </circle>
        )}
        {analysis.valley && (
          <circle cx={x(analysis.valley.position)} cy={y(analysis.valley.valence)} r="4" fill="var(--color-danger)">
            <title>{`谷 ${Math.round(analysis.valley.position * 100)}% / ${analysis.valley.valence}`}</title>
          </circle>
        )}
      </svg>
      <div className="capture-timeline-legend">
        <span><i className="capture-legend-focus" /> 平均アーク (±1σ 帯)</span>
        <span><i className="capture-legend-session" /> 各セッション</span>
        <span>● ピーク / ● 谷</span>
      </div>
    </div>
  );
}
