import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RadarChart, TrendChart } from '@volputas/charts';
import { useProfileClient } from '../lib/profileClient';
import { useRuntimeMode } from '../hooks/useRuntimeMode';
import {
  CONFIDENCE_META,
  PREFERENCE_AXIS_META,
  aversionLabel,
} from '../lib/personaAxes';

const ENGAGEMENT_LABELS = {
  emotionalEngagement: '感情表出',
  reflection: '内省・言語化',
};

function confidenceBadge(confidence) {
  const meta = CONFIDENCE_META[confidence] || CONFIDENCE_META.low;
  return <span className={`confidence-badge ${meta.className}`}>{meta.label}</span>;
}

function contributionLabel(item) {
  const kinds = {
    survey: 'アンケート',
      gameplay: 'ゲームプレイ',
      voice: 'ユーザの声',
      discussion: 'Di 議論ログ',
      emotionCurve: '感情曲線',
    steam: 'Steam',
  };
  return `${kinds[item.source?.kind] || item.source?.kind || '?'}${item.source?.field ? ` / ${item.source.field}` : ''}`;
}

export default function PersonaPage() {
  const client = useProfileClient();
  const { mode } = useRuntimeMode();
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    client.personaStatus().then(setStatus).catch((reason) => setError(reason.message));
    client.personaHistory().then(setHistory).catch(() => setHistory([]));
  }, [client]);

  async function analyze() {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const result = await client.analyzePersona();
      setStatus((current) => ({ ...current, analysis: result.analysis, stale: false }));
      setMessage(result.recomputed
        ? '更新された入力を使ってペルソナを再分析しました。'
        : '入力に変更がないため、前回の分析をそのまま使用します。');
      client.personaHistory().then(setHistory).catch(() => {});
    } catch (reason) {
      setError(reason.message);
    } finally {
      setRunning(false);
    }
  }

  async function importPopulationReport(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const report = JSON.parse(await file.text());
      const result = await client.importPopulationReport(report);
      const latest = await client.personaStatus();
      setStatus(latest);
      setMessage(result.updated
        ? '母集団レポートを取り込み、全体内での位置を更新しました。'
        : result.matched
          ? '本人の行は見つかりましたが、v2 分析がないため更新しませんでした。'
          : 'このユーザーに一致する仮名 ID はレポートにありませんでした。');
    } catch (reason) {
      setError(reason instanceof SyntaxError
        ? '母集団レポートが正しい JSON ではありません。'
        : reason.message);
    } finally {
      setRunning(false);
    }
  }

  if (!status && !error) return <div className="loading-spinner">読み込み中…</div>;
  const analysis = status?.analysis;
  const isV2 = analysis?.schemaVersion === 2 && analysis.preferenceAxes;

  const axisRows = isV2
    ? PREFERENCE_AXIS_META.map((meta) => ({ meta, axis: analysis.preferenceAxes[meta.id] }))
    : [];
  const scored = axisRows.filter(({ axis }) => axis && axis.score !== null);
  const topAxes = [...scored]
    .sort((left, right) => right.axis.score - left.axis.score)
    .slice(0, 3);
  const trendSeries = topAxes.map(({ meta }) => ({
    id: meta.id,
    label: meta.label,
    points: history.map((entry) => ({
      t: entry.analyzedAt,
      score: entry.scores?.[meta.id] ?? null,
    })),
  }));

  return (
    <div>
      <div className="page-header">
        <h2>ペルソナ分析</h2>
        <p>アンケート・ゲームプレイ情報・ユーザの声・感情曲線・Steam ライブラリから、15 軸の嗜好を可視化します。</p>
      </div>
      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}
      <div className={`analysis-freshness ${status?.stale ? 'stale' : 'current'}`}>
        <div>
          <strong>
            {status?.evidenceCount === 0
              ? '分析できる入力がありません'
              : status?.stale
                ? '前回の分析後にデータが更新されています'
                : analysis
                  ? '分析は最新です'
                  : '分析を実行できます'}
          </strong>
          <span>入力データ {status?.evidenceCount || 0} 件</span>
        </div>
        <button
          className="btn-accent"
          onClick={analyze}
          disabled={running || !status?.stale || status?.evidenceCount === 0}
        >
          {running ? '分析中…' : analysis ? '更新データで再分析' : 'ペルソナを分析'}
        </button>
        {mode === 'local' && (
          <label className={`btn-outline ${running ? 'disabled' : ''}`}>
            母集団レポートを取込
            <input
              type="file"
              accept="application/json,.json"
              hidden
              disabled={running}
              onChange={importPopulationReport}
            />
          </label>
        )}
      </div>

      {!analysis ? (
        <div className="card empty-state">
          入力データを登録すると、ここから自分のパラメータを分析できます。
        </div>
      ) : !isV2 ? (
        <div className="card empty-state">
          旧形式の分析結果です。「更新データで再分析」を実行すると 15 軸表示に切り替わります。
        </div>
      ) : (
        <div className="persona-grid">
          <section className="card persona-radar">
            <h3>嗜好 15 軸</h3>
            <RadarChart
              points={axisRows.map(({ meta, axis }) => ({
                label: meta.label,
                value: axis?.score ?? null,
                confidence: axis?.confidence || 'insufficient',
              }))}
            />
            <div className="confidence-legend">
              {Object.entries(CONFIDENCE_META).map(([key, meta]) => (
                <span key={key} className={meta.className}>{meta.label}</span>
              ))}
            </div>
            <p className="persona-note">{analysis.note}</p>
          </section>

          <section className="card">
            <h3>軸の詳細と根拠</h3>
            <div className="persona-bars">
              {axisRows.map(({ meta, axis }) => (
                <div className="persona-axis" key={meta.id}>
                  <div>
                    <span>{meta.label} {confidenceBadge(axis?.confidence || 'insufficient')}</span>
                    <strong>{axis?.score === null || !axis ? '—' : Math.round(axis.score * 100)}</strong>
                  </div>
                  {axis?.score !== null && axis ? (
                    <>
                      <div className="persona-bar"><span style={{ width: `${Math.round(axis.score * 100)}%` }} /></div>
                      <details className="provenance-drawer">
                        <summary>根拠 {axis.contributions.length} 件 (重み {axis.evidenceWeight})</summary>
                        <ul>
                          {axis.contributions.map((item, index) => (
                            <li key={index}>
                              <span>{contributionLabel(item)}</span>
                              <span>値 {Math.round(item.value * 100)} / 重み {item.weight}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      {axis.confidenceNote === 'steam-backlog-demotion' && (
                        <small>Steam の積みゲー率が高いため確度を1段下げています。</small>
                      )}
                    </>
                  ) : (
                    <small className="axis-input-hint">
                      データ不足 — <Link to={meta.inputHint.to}>{meta.inputHint.label}</Link> の入力がこの軸に効きます。
                    </small>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>表現特性</h3>
            <div className="persona-bars">
              {Object.entries(analysis.engagement || {}).map(([id, trait]) => (
                <div className="persona-axis" key={id}>
                  <div>
                    <span>{ENGAGEMENT_LABELS[id] || id}</span>
                    <strong>{trait.score === null ? '—' : Math.round(trait.score * 100)}</strong>
                  </div>
                  {trait.score !== null && (
                    <div className="persona-bar"><span style={{ width: `${Math.round(trait.score * 100)}%` }} /></div>
                  )}
                </div>
              ))}
            </div>
            {(analysis.aversions || []).length > 0 && (
              <>
                <h3 className="aversion-heading">忌避シグナル</h3>
                <ul className="aversion-list">
                  {analysis.aversions.map((item) => (
                    <li key={item.target}>
                      <span>{aversionLabel(item.target)}</span>
                      <strong>{Math.round(item.strength * 100)}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card persona-population">
            <h3>全体の中での位置</h3>
            {analysis.population ? (
              <>
                <strong>
                  {analysis.population.verdict === 'major' ? '多数派に近い嗜好' : '少数派寄りの嗜好'}
                </strong>
                <dl>
                  <div>
                    <dt>近傍比率</dt>
                    <dd>{Math.round(analysis.population.ratio * 1000) / 10}%</dd>
                  </div>
                  <div>
                    <dt>近い実ユーザー</dt>
                    <dd>
                      {analysis.population.nearestClusterSize}
                      {' / '}
                      {analysis.population.realPopulation}
                    </dd>
                  </div>
                </dl>
                <small>
                  レポート生成日時:
                  {' '}
                  {new Date(analysis.population.generatedAt).toLocaleString('ja-JP')}
                </small>
              </>
            ) : (
              <p className="muted">母集団レポートを取り込むと、全体内での位置を表示します。</p>
            )}
          </section>

          <section className="card">
            <h3>スコア推移</h3>
            <TrendChart series={trendSeries} />
          </section>

          <section className="card persona-evidence">
            <h3>分析に使ったデータ</h3>
            <dl>
              <div><dt>アンケート回答</dt><dd>{analysis.evidence.surveys}</dd></div>
              <div><dt>ゲームプレイ情報</dt><dd>{analysis.evidence.gameplay}</dd></div>
              <div><dt>ユーザの声</dt><dd>{analysis.evidence.voices}</dd></div>
              <div><dt>感情曲線</dt><dd>{analysis.evidence.emotionCurves}</dd></div>
              <div><dt>Steam ライブラリ</dt><dd>{analysis.evidence.steam ? '連携済み' : '未連携'}</dd></div>
            </dl>
            {analysis.steam?.stale && (
              <p className="stale-warning">Steam スナップショットが90日以上前のものです。再取込を推奨します。</p>
            )}
            <p>分析日時: {new Date(analysis.analyzedAt).toLocaleString('ja-JP')}</p>
          </section>
        </div>
      )}
    </div>
  );
}
