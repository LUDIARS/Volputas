import { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import SurveyQuestionInput from '../components/SurveyQuestionInput';
import { localApi } from '../lib/localApi';
import '../styles/surveys.css';
import '../styles/local.css';

function countAnswers(survey, answers) {
  if (!survey) return 0;
  return survey.questions.filter((question) => {
    const answer = answers[question.id];
    return answer !== undefined && answer !== null && String(answer).trim() !== '';
  }).length;
}

export default function LocalSurveysPage() {
  const {
    configured,
    markSurveyAnswered,
    surveys,
    surveysLoading,
  } = useOutletContext();
  const [searchParams] = useSearchParams();
  const surveyId = searchParams.get('survey');
  const survey = surveys.find((item) => item.id === surveyId) || null;
  const [answers, setAnswers] = useState({});
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingResponse, setLoadingResponse] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setAnswers({});
    setSavedPath('');
    setSuccess('');
    setError('');
    if (!survey) return () => {
      active = false;
    };

    setLoadingResponse(true);
    localApi(`/api/local/surveys/${survey.id}/response`)
      .then((response) => {
        if (active && response?.answers) setAnswers(response.answers);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
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

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await localApi(`/api/local/surveys/${survey.id}/response`, {
        method: 'PUT',
        body: { answers },
      });
      setSavedPath(result.filePath);
      setSuccess('回答をVolputasDataへ保存しました');
      markSurveyAnswered(survey.id, result.response.updatedAt);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (surveysLoading) return <div className="loading-spinner">Loading...</div>;
  if (!configured) {
    return (
      <div>
        <div className="page-header">
          <h2>Surveys</h2>
          <p>回答前にローカル設定が必要です。</p>
        </div>
        <div className="card empty-state">
          <Link to="/settings">LOCAL ONLYの歯車からデータリポジトリを設定する</Link>
        </div>
      </div>
    );
  }
  if (!surveyId) {
    return (
      <div>
        <div className="page-header">
          <h2>Surveys</h2>
          <p>左のSurveysから回答するアンケートを選択してください。</p>
        </div>
      </div>
    );
  }
  if (!survey) {
    return <div className="error-message">指定されたアンケートが見つかりません。</div>;
  }

  return (
    <div>
      <div className="page-header survey-page-title">
        <div>
          <h2>{survey.title}</h2>
          <p>{survey.description}</p>
        </div>
        <span className={`response-status ${survey.responseStatus}`}>
          {survey.responseStatus === 'answered' ? '回答済み' : '未回答'}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && (
        <div className="success-message">
          {success}
          {savedPath && <div className="saved-path">{savedPath}</div>}
        </div>
      )}

      {loadingResponse ? (
        <div className="loading-spinner">回答を読み込み中...</div>
      ) : (
        <form className="card local-survey-form" onSubmit={save}>
          <div className="survey-progress">
            {countAnswers(survey, answers)} / {survey.questions.length} 回答済み
          </div>
          <div className="questions">
            {survey.questions.map((question, index) => (
              <div key={question.id} className="question-block">
                <div className="question-text">
                  <span className="question-number">{index + 1}.</span> {question.text}
                </div>
                <SurveyQuestionInput
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => setAnswer(question.id, value)}
                />
              </div>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? '保存中...' : '回答を保存'}
          </button>
        </form>
      )}
    </div>
  );
}
