import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SurveyQuestionInput from '../components/SurveyQuestionInput';
import { localApi } from '../lib/localApi';
import '../styles/surveys.css';
import '../styles/local.css';

export default function LocalSurveysPage() {
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [configured, setConfigured] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      localApi('/api/local/config'),
      localApi('/api/local/surveys'),
    ])
      .then(async ([configData, surveys]) => {
        setConfigured(configData.configured && !configData.configurationError);
        const selectedSurvey = surveys[0] || null;
        setSurvey(selectedSurvey);
        if (!selectedSurvey || !configData.configured || configData.configurationError) return;
        const response = await localApi(`/api/local/surveys/${selectedSurvey.id}/response`);
        if (response?.answers) setAnswers(response.answers);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

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
      setSuccess('回答をVolputas-Dataへ保存しました');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-spinner">Loading...</div>;
  if (!configured) {
    return (
      <div>
        <div className="page-header">
          <h2>Surveys</h2>
          <p>回答前にローカル設定が必要です。</p>
        </div>
        {error && <div className="error-message">{error}</div>}
        <div className="card empty-state">
          <Link to="/settings">SettingsでデータリポジトリとGitHub名を設定する</Link>
        </div>
      </div>
    );
  }
  if (!survey) return <div className="empty-state">利用できるアンケートがありません。</div>;

  return (
    <div>
      <div className="page-header">
        <h2>{survey.title}</h2>
        <p>{survey.description}</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && (
        <div className="success-message">
          {success}
          {savedPath && <div className="saved-path">{savedPath}</div>}
        </div>
      )}

      <form className="card local-survey-form" onSubmit={save}>
        <div className="survey-progress">
          {Object.keys(answers).length} / {survey.questions.length} 回答済み
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
    </div>
  );
}
