// Side-by-side view of the two-school judgment an LLM analysis carries
// (`judgments` from emotionJudgment/judgmentSections.js): 西洋 (機序) on the
// left, 東洋 (全体観) on the right, 合議 underneath with the agreement level.
// Renders nothing for records evaluated before the lenses existed.
const LENS_COLUMNS = [
  { id: 'western', title: '西洋の判定 (機序)', hint: '単一の機序・計測値・再現性' },
  { id: 'eastern', title: '東洋の判定 (全体観)', hint: '体験全体・経験則・組み合わせ' },
];

const AGREEMENT_CLASS = { 高: 'agreement-high', 中: 'agreement-mid', 低: 'agreement-low' };

function LensColumn({ column, judgment }) {
  return (
    <section className="judgment-lens" aria-label={column.title}>
      <header className="judgment-lens-header">
        <strong>{column.title}</strong>
        <span className="judgment-lens-hint">{column.hint}</span>
        {judgment?.confidence && <span className="tag">確度 {judgment.confidence}</span>}
      </header>
      {judgment
        ? <pre className="evaluation-text">{judgment.text}</pre>
        : <p className="judgment-lens-missing">この判定は出力に含まれていません。</p>}
    </section>
  );
}

export default function JudgmentLensPanel({ judgments }) {
  if (!judgments) return null;
  const agreementClass = AGREEMENT_CLASS[judgments.agreement] || 'agreement-unknown';
  return (
    <div className="judgment-panel">
      <div className="judgment-lens-grid">
        {LENS_COLUMNS.map((column) => (
          <LensColumn key={column.id} column={column} judgment={judgments[column.id]} />
        ))}
      </div>
      <section className="judgment-synthesis" aria-label="合議">
        <header className="judgment-lens-header">
          <strong>合議</strong>
          <span className={`tag ${agreementClass}`}>
            一致度 {judgments.agreement || '不明'}
          </span>
          {!judgments.complete && <span className="tag">判定が一部欠けています</span>}
        </header>
        {judgments.synthesis
          ? <pre className="evaluation-text">{judgments.synthesis}</pre>
          : <p className="judgment-lens-missing">合議は出力に含まれていません。</p>}
      </section>
    </div>
  );
}
