// Cross-player GEQ / PENS table for one game (`analysis.scales` from
// gameInsight/scaleAggregate.js). Shows the raw mean on the family range and
// the within-player z — "how high" next to "how much above each player's usual".
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function number(value, digits = 2) {
  return value === null || value === undefined ? '－' : Number(value).toFixed(digits);
}

/** @implements SPEC-GAME-EXPERIENCE-SCALES */
export default function ScaleAggregateTable({ scales }) {
  return (
    <>
      <h3>体験尺度 (GEQ / PENS)</h3>
      {!scales && (
        <p className="capture-record-meta">
          このゲームの感想に尺度回答がまだありません。「ユーザの声」の体験尺度から回答すると、プレイヤー内で順序化した横断集計がここに出ます。
        </p>
      )}
      {scales && (
        <>
          <p className="capture-record-meta">
            感想 {scales.recordCount} 件 / {scales.playerCount} 人。z は各プレイヤーの他ゲームの回答を基準にした「普段との差」で、人ごとに順序化してから平均しています。
          </p>
          <table className="narrative-arc-sessions">
            <thead>
              <tr><th>尺度</th><th>下位尺度</th><th>平均 (生)</th><th>普段との差 (z)</th><th>順位 (0〜1)</th><th>人数</th></tr>
            </thead>
            <tbody>
              {Object.entries(scales.families).flatMap(([familyId, family]) => Object.entries(family.subscales).map(([subscaleId, subscale]) => (
                <tr key={`${familyId}.${subscaleId}`}>
                  <td>{family.label}<br /><small>{family.range.min}〜{family.range.max}</small></td>
                  <td>{subscale.label}</td>
                  <td>{number(subscale.raw)}</td>
                  <td className={subscale.z > 0 ? 'scale-z-up' : subscale.z < 0 ? 'scale-z-down' : ''}>{number(subscale.z)}</td>
                  <td>{number(subscale.rank)}</td>
                  <td>{subscale.playerCount}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
