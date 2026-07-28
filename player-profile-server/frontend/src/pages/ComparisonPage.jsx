import { useEffect, useMemo, useState } from 'react';
import { useProfileClient } from '../lib/profileClient';

// どっちが好き? — 2 択の体験カード比較 (1 判定 5 秒、回数無制限)。
// 回答数が増えるほど Bradley-Terry 推定の確度が上がる。
export default function ComparisonPage() {
  const client = useProfileClient();
  const [deck, setDeck] = useState([]);
  const [records, setRecords] = useState([]);
  const [pair, setPair] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([client.comparisonDeck(), client.list('comparisons')])
      .then(([deckData, recordData]) => {
        setDeck(deckData);
        setRecords(recordData);
      })
      .catch((reason) => setError(reason.message));
  }, [client]);

  const appearanceCounts = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      counts.set(record.itemA, (counts.get(record.itemA) || 0) + 1);
      counts.set(record.itemB, (counts.get(record.itemB) || 0) + 1);
    }
    return counts;
  }, [records]);

  function nextPair() {
    if (deck.length < 2) return;
    // 観測回数が少ないカードを優先しつつ、同率はシャッフルで散らす。
    const ordered = [...deck]
      .map((card) => ({ card, count: appearanceCounts.get(card.id) || 0, jitter: Math.random() }))
      .sort((left, right) => left.count - right.count || left.jitter - right.jitter);
    setPair([ordered[0].card, ordered[1].card]);
  }

  useEffect(() => {
    if (!pair && deck.length >= 2) nextPair();
  }, [deck]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(winner) {
    if (!pair || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await client.create('comparisons', {
        kind: 'experience',
        itemA: pair[0].id,
        itemB: pair[1].id,
        winner,
      });
      setRecords((current) => [result.record, ...current]);
      setPair(null);
      setTimeout(nextPair, 0);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!pair && deck.length >= 2 && records.length >= 0) nextPair();
  }, [records]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <h2>どっちが好き?</h2>
        <p>直感で選ぶだけの 2 択です。答えるほどペルソナ分析の確度が上がります。</p>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="comparison-stats">これまでの回答: {records.length} 件</div>
      {pair ? (
        <div className="comparison-pair">
          <button type="button" className="comparison-card" disabled={saving} onClick={() => choose('a')}>
            {pair[0].text}
          </button>
          <span className="comparison-vs">VS</span>
          <button type="button" className="comparison-card" disabled={saving} onClick={() => choose('b')}>
            {pair[1].text}
          </button>
        </div>
      ) : (
        <div className="card empty-state">カードを読み込み中…</div>
      )}
      <p className="form-intro comparison-hint">
        どちらとも言えないときは、より「自分らしい」と感じる方を選んでください。
      </p>
    </div>
  );
}
