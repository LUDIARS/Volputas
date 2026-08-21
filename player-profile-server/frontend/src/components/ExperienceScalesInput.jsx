// GEQ (in-game) / PENS answer block for the impression form
// (spec/feature/game-experience-scales.md §入力). Every item is optional; the
// value shape `{ geq: { itemId: n }, pens: { itemId: n } }` is what the server
// validates. Collapsed by default so a quick one-line impression stays quick.
import { useState } from 'react';
import { SCALE_FAMILIES } from '../lib/experienceScales';

/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function range(min, max) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/** @implements SPEC-GAME-EXPERIENCE-SCALES */
// A checked radio fires no change event, so onClick clears an already-chosen step.
function ItemRow({ family, item, value, onChange }) {
  const steps = range(family.range.min, family.range.max);
  return (
    <div className="scale-item">
      <span className="scale-item-text">{item.text}</span>
      <div className="scale-item-steps" role="radiogroup" aria-label={item.text}>
        {steps.map((step, index) => (
          <label key={step} className={`scale-step${value === step ? ' scale-step-active' : ''}`} title={family.anchors[index] || ''}>
            <input
              type="radio"
              name={`${family.id}.${item.id}`}
              value={step}
              checked={value === step}
              onChange={() => onChange(step)}
              onClick={() => { if (value === step) onChange(null); }}
            />
            {step}
          </label>
        ))}
      </div>
    </div>
  );
}

/** @implements SPEC-GAME-EXPERIENCE-SCALES */
export default function ExperienceScalesInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const answered = SCALE_FAMILIES.reduce((count, family) => count
    + Object.values(value?.[family.id] || {}).filter(Number.isFinite).length, 0);

  /** @implements SPEC-GAME-EXPERIENCE-SCALES */
  function setItem(familyId, itemId, step) {
    const next = { ...(value || {}), [familyId]: { ...(value?.[familyId] || {}) } };
    if (step === null) delete next[familyId][itemId];
    else next[familyId][itemId] = step;
    if (Object.keys(next[familyId]).length === 0) delete next[familyId];
    onChange(Object.keys(next).length > 0 ? next : null);
  }

  return (
    <section className="scale-block">
      <button type="button" className="scale-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? '▾' : '▸'} 体験尺度 (GEQ / PENS) {answered > 0 ? `— ${answered} 項目回答済み` : '— 任意'}
      </button>
      {open && (
        <div className="scale-families">
          <p className="form-intro">
            学術標準の尺度で体験を残します。答えた項目だけが保存され、ペルソナとゲーム洞察の横断集計に使われます。
          </p>
          {SCALE_FAMILIES.map((family) => (
            <fieldset key={family.id} className="scale-family">
              <legend>{family.label} <span className="scale-range">({family.range.min}〜{family.range.max})</span></legend>
              {family.subscales.map((subscale) => (
                <div key={subscale.id} className="scale-subscale">
                  <strong>{subscale.label}</strong>
                  {subscale.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      family={family}
                      item={item}
                      value={value?.[family.id]?.[item.id] ?? null}
                      onChange={(step) => setItem(family.id, item.id, step)}
                    />
                  ))}
                </div>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}
