// Focus-score sparkline plus markers for one capture session, on the shared
// sessionMs axis. Same minimal-SVG idiom as TrendChart.
const WIDTH = 560;
const HEIGHT = 140;
const PADDING = { top: 12, right: 12, bottom: 30, left: 30 };

const MARKER_COLORS = {
  hype: 'var(--color-accent)',
  like: 'var(--color-primary)',
  dislike: 'var(--color-text-muted)',
  stress: 'var(--color-danger)',
  event: 'var(--color-border)',
  note: 'var(--color-border)',
};

function formatClock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function CaptureTimelineView({ timeline }) {
  const durationMs = Math.max(timeline.durationMs, timeline.binMs);
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (ms) => PADDING.left + (Math.min(ms, durationMs) / durationMs) * plotW;
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
        {timeline.gaze.length >= 2 && (
          <polyline
            points={timeline.gaze
              .map((bin) => `${x(bin.t + timeline.binMs / 2)},${y(bin.focusScore)}`)
              .join(' ')}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
          />
        )}
        {timeline.gaze.map((bin) => (
          <circle
            key={bin.t}
            cx={x(bin.t + timeline.binMs / 2)}
            cy={y(bin.focusScore)}
            r="2"
            fill="var(--color-primary)"
          >
            <title>{`${formatClock(bin.t)} 注視 ${Math.round(bin.focusScore * 100)} / 画面内 ${Math.round(bin.onScreenRatio * 100)}%`}</title>
          </circle>
        ))}
        {timeline.markers.map((marker, index) => (
          <g key={`${marker.sessionMs}-${index}`}>
            <line
              x1={x(marker.sessionMs)} y1={PADDING.top}
              x2={x(marker.sessionMs)} y2={HEIGHT - PADDING.bottom}
              stroke={MARKER_COLORS[marker.type] || 'var(--color-border)'}
              strokeWidth="1.5"
            />
            <text
              x={x(marker.sessionMs)} y={HEIGHT - PADDING.bottom + 12}
              textAnchor="middle" fontSize="8" fill="var(--color-text-muted)"
            >
              {formatClock(marker.sessionMs)}
            </text>
          </g>
        ))}
      </svg>
      {timeline.gaze.length === 0 && (
        <div className="empty-state">視線サンプルはありません (マーカーのみ表示)。</div>
      )}
      {timeline.markers.length > 0 && (
        <ul className="capture-marker-list">
          {timeline.markers.map((marker, index) => (
            <li key={`${marker.sessionMs}-${index}`}>
              <span className="capture-marker-time">{formatClock(marker.sessionMs)}</span>
              {' '}
              <span className="capture-marker-type">{marker.type}</span>
              {marker.label ? ` — ${marker.label}` : ''}
              <span className="capture-marker-origin"> ({marker.origin})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
