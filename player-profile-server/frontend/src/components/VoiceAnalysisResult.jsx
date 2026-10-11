import VoiceReviewArc from './VoiceReviewArc';

const VALUES = {
  present: 'あり', absent: '明示的になし', positive: '肯定', neutral: '中立', negative: '否定',
  seek: '望む', avoid: '避けたい',
};
const STATES = {
  not_experienced: '未体験', not_applicable: '対象外', unresolved: '判断できない',
};

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
export function VoiceEvidence({ evidence }) {
  return <blockquote className="voice-evidence">{evidence.quote}<small>{evidence.sourceId === 'comment' ? '感想の本文' : '追加回答'}</small></blockquote>;
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
export default function VoiceAnalysisResult({ analysis, catalog }) {
  const definitions = new Map(catalog.axes.map((axis) => [axis.id, axis]));
  const observations = new Map(analysis.observations.map((item) => [item.id, item]));
  const groups = [...new Set(catalog.axes.map((axis) => axis.group))];
  return (
    <div>
      <p className="voice-analysis-caution">AIによる読み取りです。引用は原文と照合済みですが、意味の読み取りは人による確認が必要です。人々全体の傾向や因果関係を示す結果ではありません。</p>
      <p>{new Date(analysis.analyzedAt).toLocaleString('ja-JP')} に解析。記述のある項目：{analysis.coverage.mentionedAxes} / {analysis.coverage.totalAxes}（精度の点数ではありません）。</p>
      <p>書かれていない項目は「不明」のまま残します。中立・未体験・対象外と区別し、賛否が混ざる場合は両方を表示します。</p>
      {groups.map((group) => {
        const items = analysis.observations.filter((item) => definitions.get(item.axisId)?.group === group);
        if (!items.length) return null;
        return <section key={group}>
          <h5>{group}</h5>
          {items.map((item) => <div key={item.id} className="voice-observation">
            <strong>{definitions.get(item.axisId)?.label}：{item.status === 'observed' ? VALUES[item.value] : STATES[item.status]}</strong>
            {item.eventId && <span>（{analysis.arc.events.find((event) => event.id === item.eventId)?.label}）</span>}
            <VoiceEvidence evidence={item.evidence} />
          </div>)}
        </section>;
      })}
      {analysis.observations.length === 0 && <p>この文章から既存の項目に当てはまる情報は読み取れませんでした。</p>}
      <VoiceReviewArc arc={analysis.arc} />
      {analysis.links.length > 0 && <section>
        <h5>行動と体験のつながり</h5>
        <p>本人が述べたつながりです。効果を実証したものではありません。</p>
        {analysis.links.map((link, index) => <div key={index}>
          <p>{definitions.get(observations.get(link.dObservationId)?.axisId)?.label} → {definitions.get(observations.get(link.aObservationId)?.axisId)?.label}</p>
          <VoiceEvidence evidence={link.evidence} />
        </div>)}
      </section>}
      {analysis.unclassified.length > 0 && <section>
        <h5>既存の項目に収まらない内容</h5>
        {analysis.unclassified.map((item, index) => <div key={index}>
          <p>{item.label}</p><VoiceEvidence evidence={item.evidence} />
        </div>)}
      </section>}
    </div>
  );
}
