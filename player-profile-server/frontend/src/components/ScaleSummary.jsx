// Compact GEQ / PENS subscale readout for one impression record. Renders
// nothing when the record carries no scale answers.
import { SCALE_FAMILIES, scoreScales } from '../lib/experienceScales';

/** @implements SPEC-GAME-EXPERIENCE-SCALES */
export default function ScaleSummary({ scales }) {
  const scored = scoreScales(scales);
  if (!scored) return null;
  return (
    <div className="scale-summary">
      {SCALE_FAMILIES.filter((family) => scored[family.id]).map((family) => (
        <div key={family.id} className="scale-summary-family">
          <span className="scale-summary-label">{family.label}</span>
          {family.subscales.filter((subscale) => scored[family.id][subscale.id] !== undefined).map((subscale) => (
            <span key={subscale.id} className="tag scale-chip" title={`${subscale.label} (${family.range.min}〜${family.range.max})`}>
              {subscale.label} {Number(scored[family.id][subscale.id].toFixed(1))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
