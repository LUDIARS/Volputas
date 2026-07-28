import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import SurveyQuestionInput from '../components/SurveyQuestionInput';
import { api } from '../lib/api';
import '../styles/surveys.css';

export default function SurveysPage() {
  const { markSurveyAnswered, surveys, surveysLoading } = useOutletContext();
  const [searchParams] = useSearchParams();
  const surveyId = searchParams.get('survey');
  const survey = surveys.find((item) => item.id === surveyId) || null;
  const [answers, setAnswers] = useState({});
  const [hasExistingResponse, setHasExistingResponse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loadingResponse, setLoadingResponse] = useState(false);

  useEffect(() => {
    let active = true;
    setAnswers({});
    setHasExistingResponse(false);
    setSuccess('');
    setError('');
    if (!survey) return () => {
      active = false;
    };

    setLoadingResponse(true);
    api(`/api/v1/surveys/${survey.id}/responses/me`)
      .then((result) => {
        if (!active) return;
        setHasExistingResponse(true);
        setAnswers(result.data.answers || {});
      })
      .catch((requestError) => {
        if (active && requestError.status !== 404) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingResponse(false);
      });
    return () => {
      active = false;
    };
  }, [survey?.id]);

  function setAnswer(questionId, value) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api(`/api/v1/surveys/${survey.id}/responses`, {
        method: 'POST',
        body: { answers },
      });
      setHasExistingResponse(true);
      setSuccess('Response submitted successfully');
      markSurveyAnswered(survey.id, result.data.submitted_at);
    } catch (requestError) {
      setError(requestError.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (surveysLoading) return <div className="loading-spinner">Loading...</div>;
  if (!surveyId) {
    return (
      <div className="page-header">
        <h2>Surveys</h2>
        <p>Select a survey from the sidebar.</p>
      </div>
    );
  }
  if (!survey) return <div className="error-message">Survey not found.</div>;

  return (
    <div>
      <div className="page-header survey-page-title">
        <div>
          <h2>{survey.title}</h2>
          <p>{survey.description}</p>
        </div>
        <span className={`response-status ${survey.responseStatus}`}>
          {survey.responseStatus === 'answered' ? 'Answered' : 'Unanswered'}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {hasExistingResponse && (
        <div className="info-banner">
          You have already responded. Submitting again will update your answers.
        </div>
      )}

      {loadingResponse ? (
        <div className="loading-spinner">Loading response...</div>
      ) : (
        <form className="card survey-form" onSubmit={submit}>
          <div className="questions">
            {survey.questions.map((question) => (
              <div key={question.id} className="question-block">
                <div className="question-text">{question.text}</div>
                <SurveyQuestionInput
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => setAnswer(question.id, value)}
                />
              </div>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? 'Submitting...'
              : hasExistingResponse ? 'Update Response' : 'Submit Response'}
          </button>
        </form>
      )}
    </div>
  );
}
