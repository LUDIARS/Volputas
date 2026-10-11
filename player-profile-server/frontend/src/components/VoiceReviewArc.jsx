const VALENCE = { negative: '否定的', neutral: '中立', positive: '肯定的' };
const DIRECTION = { '-1': '否定的な方向へ', 0: '同じ区分', 1: '肯定的な方向へ' };

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
export default function VoiceReviewArc({ arc }) {
  const events = new Map(arc.events.map((event) => [event.id, event]));
  return <section>
    <h5>場面と感情の変化</h5>
    <p>感想に書かれた前後関係だけを結びます。時間の長さや感情の強さは測定していません。</p>
    {!arc.events.length && <p>場面を特定できる記述はありません。</p>}
    <ul className="voice-arc-events">
      {arc.events.map((event) => <li key={event.id}>
        <strong>{event.label}</strong> — {VALENCE[event.valence] ?? '感情の方向は不明'}
        <blockquote className="voice-evidence">{event.evidence.quote}</blockquote>
        {event.valenceEvidence && event.valenceEvidence.quote !== event.evidence.quote && <blockquote className="voice-evidence">感情の根拠：{event.valenceEvidence.quote}</blockquote>}
      </li>)}
    </ul>
    {arc.events.length > 0 && !arc.transitions.length && <p>場面の順序は不明です。上の表示順は体験した順序を意味しません。</p>}
    {arc.transitions.map((edge) => <div className="voice-arc-transition" key={`${edge.from}:${edge.to}`}>
      <p>{events.get(edge.from)?.label} → {events.get(edge.to)?.label}</p>
      <p>{edge.direction === null ? '感情の変化は判断できません' : DIRECTION[edge.direction]}</p>
      <blockquote className="voice-evidence">順序の根拠：{edge.evidence.quote}</blockquote>
    </div>)}
  </section>;
}
