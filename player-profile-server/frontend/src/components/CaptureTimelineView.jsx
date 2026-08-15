// Timeline for one capture session on the shared sessionMs axis
// (spec/feature/emotion-capture-companion.md §タイムライン): focus-score
// sparkline from gaze, speech valence from the local analysis, one-tap markers,
// and (when a replay is attached) a playhead plus click-to-seek. Same
// minimal-SVG idiom as TrendChart.
const WIDTH = 560;
const HEIGHT = 170;
const PADDING = { top: 12, right: 12, bottom: 30, left: 30 };

const MARKER_COLORS = {
  hype: 'var(--color-accent)',
  like: 'var(--color-primary)',
  dislike: 'var(--color-text-muted)',
  stress: 'var(--color-danger)',
  event: 'var(--color-border)',
  note: 'var(--color-border)',
};

export function formatClock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function CaptureTimelineView({ timeline, playheadMs = null, onSeek = null }) {
  const durationMs = Math.max(timeline.durationMs, timeline.binMs);
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (ms) => PADDING.left + (Math.min(ms, durationMs) / durationMs) * plotW;
  const y = (score) => PADDING.top + (1 - score) * plotH;
  // Valence -2..2 shares the plot: map onto the same 0..1 band.
  const yValence = (valence) => y((valence + 2) / 4);
  const affect = timeline.affect || [];

  function seekFromEvent(event) {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const plotRatio = (ratio * WIDTH - PADDING.left) / plotW;
    onSeek(Math.min(Math.max(plotRatio, 0), 1) * durationMs);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', height: 'auto', cursor: onSeek ? 'pointer' : 'default' }}
        onClick={seekFromEvent}
        role={onSeek ? 'slider' : undefined}
        aria-label={onSeek ? 'タイムラインをクリックしてシーク' : undefined}
      >
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
        {affect.length >= 2 && (
          <polyline
            points={affect.map((point) => `${x(point.sessionMs)},${yValence(point.valence)}`).join(' ')}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
        )}
        {affect.map((point, index) => (
          <circle
            key={`affect-${point.sessionMs}-${index}`}
            cx={x(point.sessionMs)}
            cy={yValence(point.valence)}
            r="2.5"
            fill="var(--color-accent)"
          >
            <title>{`${formatClock(point.sessionMs)} 感情価 ${point.valence} / 強さ ${point.arousal} — ${point.text}`}</title>
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
        {playheadMs !== null && (
          <line
            x1={x(playheadMs)} y1={PADDING.top - 4}
            x2={x(playheadMs)} y2={HEIGHT - PADDING.bottom + 4}
            stroke="var(--color-text)" strokeWidth="1.5"
          />
        )}
      </svg>
      <div className="capture-timeline-legend">
        <span><i className="capture-legend-focus" /> 注視スコア (視線)</span>
        <span><i className="capture-legend-affect" /> 発話の感情価 (-2..+2)</span>
        <span>縦線: マーカー</span>
      </div>
      {timeline.gaze.length === 0 && (
        <div className="empty-state">視線サンプルはありません (マーカーのみ表示)。</div>
      )}
      {timeline.markers.length > 0 && (
        <ul className="capture-marker-list">
          {timeline.markers.map((marker, index) => (
            <li key={`${marker.sessionMs}-${index}`}>
              {onSeek ? (
                <button type="button" className="capture-seek-link" onClick={() => onSeek(marker.sessionMs)}>
                  {formatClock(marker.sessionMs)}
                </button>
              ) : (
                <span className="capture-marker-time">{formatClock(marker.sessionMs)}</span>
              )}
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
