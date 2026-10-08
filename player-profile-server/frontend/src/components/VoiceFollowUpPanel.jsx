import { useEffect, useState } from 'react';

// One follow-up question at a time for a saved voice. The player may answer,
// skip the question, or close the panel and resume later from the record.
export default function VoiceFollowUpPanel({ client, recordId, onRecordUpdated, onClose }) {
  const [question, setQuestion] = useState(undefined);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setQuestion(undefined);
    client.voiceFollowUp(recordId)
      .then((result) => { if (!cancelled) setQuestion(result.question); })
      .catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [client, recordId]);

  async function send(body) {
    setBusy(true);
    setError('');
    try {
      const result = await client.answerVoiceFollowUp(recordId, { questionId: question.id, ...body });
      onRecordUpdated(result.record);
      setQuestion(result.question);
      setAnswer('');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  if (question === undefined && !error) {
    return <div className="card follow-up-panel">追加の質問を確認しています…</div>;
  }

  return (
    <section className="card follow-up-panel" aria-live="polite">
      <div className="follow-up-heading">
        <h4>追加の質問</h4>
        <button type="button" className="btn-outline" onClick={onClose}>あとで答える</button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {question === null && (
        <p className="form-intro">十分な情報がそろいました。ご協力ありがとうございます。</p>
      )}
      {question && (
        <>
          <p className="follow-up-prompt">{question.prompt}</p>
          {question.answerType === 'choice' ? (
            <div className="follow-up-options">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="btn-outline"
                  disabled={busy}
                  onClick={() => send({ answer: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send({ answer });
              }}
            >
              <textarea
                rows="3"
                maxLength={2000}
                value={answer}
                disabled={busy}
                onChange={(event) => setAnswer(event.target.value)}
              />
              <button className="btn-primary" disabled={busy || !answer.trim()}>回答する</button>
            </form>
          )}
          <button
            type="button"
            className="follow-up-skip"
            disabled={busy}
            onClick={() => send({ skip: true })}
          >
            この質問はスキップ
          </button>
        </>
      )}
    </section>
  );
}
