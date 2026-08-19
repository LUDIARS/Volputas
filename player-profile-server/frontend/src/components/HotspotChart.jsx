// Cross-player hotspot chart (spec/feature/game-insight.md §UI): player-weighted
// mean valence with a ±1σ band, arousal as faint bars, the survival curve as a
// dashed line on a 0..1 right axis, hotspots (● hype / ● pain) and dropouts (▼).
// Same minimal-SVG idiom as NarrativeArcChart.
const WIDTH = 560;
const HEIGHT = 220;
const PADDING = { top: 14, right: 34, bottom: 28, left: 32 };

function pathFor(points) {
  let path = '';
  let open = false;
  for (const point of points) {
    if (point === null) { open = false; continue; }
    path += `${open ? 'L' : 'M'}${point[0]},${point[1]} `;
    open = true;
  }
  return path.trim();
}

/** @implements SPEC-GAME-INSIGHT */
export default function HotspotChart({ analysis }) {
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;
  const bins = analysis.bins || [];
  const binWidth = plotW / Math.max(bins.length, 1);
  const x = (position) => PADDING.left + position * plotW;
  const y = (valence) => PADDING.top + (1 - (valence + 2) / 4) * plotH;
  const yRate = (rate) => PADDING.top + (1 - rate) * plotH;
  const arousalHeight = (arousal) => ((arousal - 1) / 4) * plotH;

  const mean = pathFor(bins.map((bin) => (bin.valence === null ? null : [x(bin.position), y(bin.valence)])));
  const covered = bins.filter((bin) => bin.valence !== null);
  const bandTop = covered.map((bin) => `${x(bin.position)},${y(Math.min(bin.valence + (bin.valenceDeviation || 0), 2))}`);
  const bandBottom = covered.map((bin) => `${x(bin.position)},${y(Math.max(bin.valence - (bin.valenceDeviation || 0), -2))}`).reverse();
  const survival = pathFor((analysis.survival || []).map((rate, index) => (
    rate === null || !bins[index] ? null : [x(bins[index].position), yRate(rate)]
  )));

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="ホットスポットと脱落点">
        {bins.map((bin) => (bin.arousal === null ? null : (
          <rect
            key={`arousal-${bin.bin}`}
            x={x(bin.position) - binWidth / 2 + 1}
            y={PADDING.top + plotH - arousalHeight(bin.arousal)}
            width={Math.max(binWidth - 2, 1)}
            height={arousalHeight(bin.arousal)}
            fill="var(--color-accent)"
            opacity="0.12"
          >
            <title>{`強さ ${bin.arousal} / ${bin.playerCoverage} 人`}</title>
          </rect>
        )))}
        {[-2, -1, 0, 1, 2].map((tick) => (
          <g key={tick}>
            <line x1={PADDING.left} y1={y(tick)} x2={WIDTH - PADDING.right} y2={y(tick)} stroke="var(--color-border)" strokeWidth={tick === 0 ? 1 : 0.5} />
            <text x={PADDING.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="central" fontSize="9" fill="var(--color-text-muted)">
              {tick > 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((rate) => (
          <text key={rate} x={WIDTH - PADDING.right + 6} y={yRate(rate)} textAnchor="start" dominantBaseline="central" fontSize="9" fill="var(--color-text-muted)">
            {Math.round(rate * 100)}%
          </text>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((position) => (
          <text key={position} x={x(position)} y={HEIGHT - PADDING.bottom + 14} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)">
            {Math.round(position * 100)}%
          </text>
        ))}
        {bandTop.length >= 2 && (
          <polygon points={[...bandTop, ...bandBottom].join(' ')} fill="var(--color-primary)" opacity="0.12" />
        )}
        {mean && <path d={mean} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" />}
        {survival && <path d={survival} fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeDasharray="4 3" />}
        {(analysis.hotspots || []).map((spot) => (
          <circle
            key={`spot-${spot.bin}`}
            cx={x(spot.position)}
            cy={y(spot.valence ?? 0)}
            r="5"
            fill={spot.kind === 'pain' ? 'var(--color-danger)' : 'var(--color-accent)'}
          >
            <title>{`${spot.kind === 'pain' ? 'つまずき' : '盛り上がり'} ${Math.round(spot.position * 100)}% / ${spot.playerCount} 人`}</title>
          </circle>
        ))}
        {(analysis.dropouts || []).map((dropout) => (
          <polygon
            key={`drop-${dropout.bin}`}
            points={`${x(dropout.position) - 5},${PADDING.top} ${x(dropout.position) + 5},${PADDING.top} ${x(dropout.position)},${PADDING.top + 9}`}
            fill="var(--color-danger)"
          >
            <title>{`脱落 ${Math.round(dropout.position * 100)}% / ${dropout.sessionCount} セッション`}</title>
          </polygon>
        ))}
      </svg>
      <div className="capture-timeline-legend">
        <span><i className="capture-legend-focus" /> 平均感情価 (プレイヤー 1 票, ±1σ)</span>
        <span>▮ 強さ</span>
        <span>╌ 生存曲線 (右軸)</span>
        <span>● 盛り上がり / ● つまずき / ▼ 脱落</span>
      </div>
    </div>
  );
}
