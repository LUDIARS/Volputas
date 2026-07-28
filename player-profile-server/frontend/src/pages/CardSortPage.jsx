import { useEffect, useMemo, useState } from 'react';
import { useProfileClient } from '../lib/profileClient';
import lexicon from '../data/ludus-lexicon.json';

const BUCKETS = [
  { id: 'love', label: '刺さる', icon: '♥' },
  { id: 'neutral', label: 'どちらでも', icon: '―' },
  { id: 'avoid', label: '苦手', icon: '×' },
];

const MECHANICS = [...lexicon.mechanics]
  .sort((left, right) => left.id.localeCompare(right.id));

function versionOf(record) {
  return [
    record.updatedAt || record.createdAt || '',
    record.id || '',
    record.bucket || '',
  ].join('\u0000');
}

function latestByMechanic(records) {
  const latest = new Map();
  for (const record of records) {
    const current = latest.get(record.mechanicId);
    if (!current || versionOf(record) > versionOf(current)) {
      latest.set(record.mechanicId, record);
    }
  }
  return latest;
}

export default function CardSortPage() {
  const client = useProfileClient();
  const [records, setRecords] = useState([]);
  const [savingMechanicId, setSavingMechanicId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    client.list('card-sorts')
      .then(setRecords)
      .catch((reason) => setError(reason.message));
  }, [client]);

  const activeRecords = useMemo(() => latestByMechanic(records), [records]);
  const classifiedCount = MECHANICS
    .filter((mechanic) => activeRecords.has(mechanic.id))
    .length;
  const currentMechanic = MECHANICS.find((mechanic) => !activeRecords.has(mechanic.id));

  async function sortMechanic(mechanicId, bucket) {
    if (savingMechanicId) return;
    setSavingMechanicId(mechanicId);
    setError('');
    try {
      const result = await client.create('card-sorts', { mechanicId, bucket });
      setRecords((current) => [result.record, ...current]);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSavingMechanicId('');
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>メカニクス・カードソート</h2>
        <p>ゲームの仕組みを「刺さる・どちらでも・苦手」の 3 山に分けます。</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      <div className="card-sort-progress">
        分類済み: {classifiedCount} / {MECHANICS.length}
      </div>

      {currentMechanic ? (
        <section className="card card-sort-current">
          <div className="card-sort-category">{currentMechanic.id.split('/')[0]}</div>
          <h3>{currentMechanic.nameJa}</h3>
          <p>{currentMechanic.nameEn}</p>
          <div className="card-sort-actions" role="group" aria-label={`${currentMechanic.nameJa} の分類`}>
            {BUCKETS.map((bucket) => (
              <button
                key={bucket.id}
                type="button"
                className={`card-sort-choice card-sort-choice-${bucket.id}`}
                disabled={Boolean(savingMechanicId)}
                onClick={() => sortMechanic(currentMechanic.id, bucket.id)}
              >
                <span aria-hidden="true">{bucket.icon}</span>
                {bucket.label}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="success-message">43 件すべてを分類しました。各山からいつでも移動できます。</div>
      )}

      <div className="card-sort-piles">
        {BUCKETS.map((bucket) => {
          const mechanics = MECHANICS.filter((mechanic) =>
            activeRecords.get(mechanic.id)?.bucket === bucket.id);
          return (
            <section className={`card-sort-pile card-sort-pile-${bucket.id}`} key={bucket.id}>
              <h3>
                <span aria-hidden="true">{bucket.icon}</span>
                {bucket.label}
                <span className="card-sort-pile-count">{mechanics.length}</span>
              </h3>
              {mechanics.length === 0 && <p className="card-sort-empty">まだありません</p>}
              {mechanics.map((mechanic) => (
                <article className="card-sort-item" key={mechanic.id}>
                  <div>
                    <strong>{mechanic.nameJa}</strong>
                    <small>{mechanic.id}</small>
                  </div>
                  <div
                    className="card-sort-move"
                    role="group"
                    aria-label={`${mechanic.nameJa} を移動`}
                  >
                    {BUCKETS.filter((target) => target.id !== bucket.id).map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        title={`${target.label}へ移動`}
                        aria-label={`${target.label}へ移動`}
                        disabled={Boolean(savingMechanicId)}
                        onClick={() => sortMechanic(mechanic.id, target.id)}
                      >
                        {target.icon}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
