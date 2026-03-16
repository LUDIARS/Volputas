import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import '../styles/surveys.css';

export default function SurveysPage() {
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [existingResponse, setExistingResponse] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSurveys();
  }, []);

  async function loadSurveys() {
    try {
      const res = await api('/api/v1/surveys');
      setSurveys(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function selectSurvey(survey) {
    setSelectedSurvey(survey);
    setAnswers({});
    setExistingResponse(null);
    setSuccess('');
    setError('');

    try {
      const res = await api(`/api/v1/surveys/${survey.id}/responses/me`);
      setExistingResponse(res.data);
      setAnswers(res.data.answers || {});
    } catch {
      // No existing response — that's fine
    }
  }

  function setAnswer(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await api(`/api/v1/surveys/${selectedSurvey.id}/responses`, {
        method: 'POST',
        body: { answers },
      });
      setSuccess('Response submitted successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  function renderQuestion(q) {
    const value = answers[q.id];

    switch (q.type) {
      case 'scale': {
        const min = q.options?.min ?? 1;
        const max = q.options?.max ?? 5;
        return (
          <div className="scale-input">
            <span className="scale-label">{min}</span>
            <input
              type="range"
              min={min}
              max={max}
              value={value ?? min}
              onChange={(e) => setAnswer(q.id, Number(e.target.value))}
            />
            <span className="scale-label">{max}</span>
            <span className="scale-value">{value ?? min}</span>
          </div>
        );
      }
      case 'choice': {
        const options = q.options?.choices || [];
        return (
          <div className="choice-options">
            {options.map((opt, i) => (
              <label key={i} className={`choice-option ${value === opt ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={q.id}
                  value={opt}
                  checked={value === opt}
                  onChange={() => setAnswer(q.id, opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      case 'freetext':
        return (
          <textarea
            value={value || ''}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            rows={3}
            placeholder="Enter your answer..."
          />
        );
      default:
        return <input value={value || ''} onChange={(e) => setAnswer(q.id, e.target.value)} />;
    }
  }

  if (loading) return <div className="loading-spinner">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Surveys</h2>
        <p>Answer surveys to improve your preference analysis</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="surveys-layout">
        {/* Survey List */}
        <div className="card survey-list">
          <h3>Active Surveys</h3>
          {surveys.length === 0 ? (
            <div className="empty-state">No active surveys</div>
          ) : (
            <div className="survey-items">
              {surveys.map((s) => (
                <div
                  key={s.id}
                  className={`survey-item ${selectedSurvey?.id === s.id ? 'active' : ''}`}
                  onClick={() => selectSurvey(s)}
                >
                  <div className="survey-title">{s.title}</div>
                  {s.description && (
                    <div className="survey-desc">{s.description}</div>
                  )}
                  <div className="survey-meta">
                    {Array.isArray(s.questions) ? s.questions.length : 0} questions
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Survey Form */}
        <div className="card survey-form">
          {!selectedSurvey ? (
            <div className="empty-state">Select a survey to answer</div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h3>{selectedSurvey.title}</h3>
              {selectedSurvey.description && (
                <p className="muted" style={{ marginBottom: '1.5rem' }}>
                  {selectedSurvey.description}
                </p>
              )}

              {existingResponse && (
                <div className="info-banner">
                  You have already responded. Submitting again will update your answers.
                </div>
              )}

              <div className="questions">
                {(Array.isArray(selectedSurvey.questions) ? selectedSurvey.questions : []).map((q) => (
                  <div key={q.id} className="question-block">
                    <div className="question-text">{q.text}</div>
                    {q.dimension && (
                      <span className="tag" style={{ marginBottom: '0.5rem' }}>
                        {q.dimension}
                      </span>
                    )}
                    {renderQuestion(q)}
                  </div>
                ))}
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ marginTop: '1.5rem' }}
              >
                {submitting ? 'Submitting...' : existingResponse ? 'Update Response' : 'Submit Response'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
