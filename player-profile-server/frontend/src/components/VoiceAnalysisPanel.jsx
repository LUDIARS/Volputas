import { useEffect, useRef, useState } from 'react';
import VoiceAnalysisResult from './VoiceAnalysisResult';
import '../styles/voice-analysis.css';

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
export default function VoiceAnalysisPanel({ client, record }) {
  const [result, setResult] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    setLoading(true);
    setBusy(false);
    setResult(null);
    setError('');
    setConsent(false);
    Promise.all([client.voiceAnalysisCatalog(), client.voiceAnalysis(record.id)])
      .then(([dictionary, status]) => {
        if (generation.current !== token) return;
        setCatalog(dictionary);
        setResult(status);
      })
      .catch((reason) => { if (generation.current === token) setError(reason.message); })
      .finally(() => { if (generation.current === token) setLoading(false); });
    return () => { generation.current += 1; };
  }, [client, record]);

  async function analyze() {
    const token = generation.current;
    setBusy(true);
    setError('');
    try {
      const status = await client.analyzeVoice(record.id);
      if (generation.current === token) setResult(status);
    } catch (reason) {
      if (generation.current === token) setError(reason.message);
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }

  return (
    <section className="voice-analysis" aria-label="声の解析" aria-busy={busy || loading}>
      <h4>声の解析</h4>
      {loading && <p role="status">保存済みの解析を確認中…</p>}
      {error && <p role="alert">{error}</p>}
      {result?.state === 'stale' && <p>感想・追加回答、または解析の仕組みが変わりました。再解析が必要です。</p>}
      {!loading && result?.state !== 'complete' && (
        <>
          <label className="voice-analysis-consent">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
            この感想・追加回答とゲームの情報を、設定済みのAIへ送って解析します。
          </label>
          <button type="button" className="btn-primary" disabled={!consent || busy || !catalog} onClick={analyze}>
            {busy ? '解析中…（数分かかる場合があります）' : 'この声を解析する'}
          </button>
        </>
      )}
      {result?.analysis && catalog && <VoiceAnalysisResult analysis={result.analysis} catalog={catalog} />}
    </section>
  );
}
