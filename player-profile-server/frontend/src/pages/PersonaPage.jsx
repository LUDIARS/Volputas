import { useEffect, useState } from 'react';
import RadarChart from '../components/RadarChart';
import { useProfileClient } from '../lib/profileClient';

export default function PersonaPage() {
  const client = useProfileClient();
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    client.personaStatus().then(setStatus).catch((reason) => setError(reason.message));
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
    } catch (reason) {
      setError(reason.message);
    } finally {
      setRunning(false);
    }
  }

  if (!status && !error) return <div className="loading-spinner">読み込み中…</div>;
  const analysis = status?.analysis;
  const axes = analysis ? Object.entries(analysis.axes) : [];

  return (
    <div>
      <div className="page-header">
        <h2>ペルソナ分析</h2>
        <p>アンケート・ゲームプレイ情報・ユーザの声・感情曲線から、自分の傾向を可視化します。</p>
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
      </div>

      {!analysis ? (
        <div className="card empty-state">
          入力データを登録すると、ここから自分のパラメータを分析できます。
        </div>
      ) : (
        <div className="persona-grid">
          <section className="card persona-radar">
            <h3>プレイ・体験パラメータ</h3>
            <RadarChart
              dimensions={axes.map(([, axis]) => axis.label)}
              vector={axes.map(([, axis]) => axis.score / 100)}
            />
            <p className="persona-note">{analysis.note}</p>
          </section>
          <section className="card">
            <h3>パラメータ詳細</h3>
            <div className="persona-bars">
              {axes.map(([id, axis]) => (
                <div className="persona-axis" key={id}>
                  <div><span>{axis.label}</span><strong>{axis.score}</strong></div>
                  <div className="persona-bar"><span style={{ width: `${axis.score}%` }} /></div>
                  <small>根拠ウェイト {axis.evidenceWeight}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="card persona-evidence">
            <h3>分析に使ったデータ</h3>
            <dl>
              <div><dt>アンケート回答</dt><dd>{analysis.evidence.surveys}</dd></div>
              <div><dt>ゲームプレイ情報</dt><dd>{analysis.evidence.gameplay}</dd></div>
              <div><dt>ユーザの声</dt><dd>{analysis.evidence.voices}</dd></div>
              <div><dt>感情曲線</dt><dd>{analysis.evidence.emotionCurves}</dd></div>
            </dl>
            <p>分析日時: {new Date(analysis.analyzedAt).toLocaleString('ja-JP')}</p>
          </section>
          <section className="card">
            <h3>強く表れた傾向</h3>
            {analysis.leadingAxes.length === 0 ? (
              <div className="empty-state">傾向を示す根拠が不足しています。</div>
            ) : (
              <ol className="leading-axes">
                {analysis.leadingAxes.map((axis) => (
                  <li key={axis.id}><span>{axis.label}</span><strong>{axis.score}</strong></li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
