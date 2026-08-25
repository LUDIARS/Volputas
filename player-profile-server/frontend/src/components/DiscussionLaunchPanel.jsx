import { useState } from 'react';
import { api } from '../lib/api';

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
export default function DiscussionLaunchPanel({ impressionId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
  async function launch() {
    setBusy(true);
    setError('');
    try {
      const response = await api(
        `/api/v1/impressions/${encodeURIComponent(impressionId)}/discussions`,
        { method: 'POST' },
      );
      setResult(response.data);
    } catch (requestError) {
      setError(requestError.message || 'Discutereで議論を開始できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card discussion-launch-panel">
      <div>
        <h3>自分の分身と議論する</h3>
        <p className="impression-muted">
          この感想と、研究利用に同意済みの匿名プレイヤー傾向だけを Discutere に送り、
          あなたの分身を参加者に含めた議論を始めます。
        </p>
      </div>
      <button className="btn-accent" type="button" disabled={busy || !!result} onClick={launch}>
        {busy ? '議論を準備中…' : result ? '議論を開始済み' : '分身と議論を開始'}
      </button>
      {error && <div className="error-message">{error}</div>}
      {result && (
        <div className="discussion-launch-result">
          {result.reviewRequired
            ? '議論ペーパーを作成しました。Discutereで内容を確認して開始してください。'
            : 'Discutereで分身を含む議論を開始しました。'}
          <span>session: {result.sessionId}</span>
        </div>
      )}
    </section>
  );
}
