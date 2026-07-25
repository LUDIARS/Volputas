import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const [surveys, setSurveys] = useState([]);
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [configured, setConfigured] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingResponse, setLoadingResponse] = useState(false);
  const [saving, setSaving] = useState(false);

  async function selectSurvey(selectedSurvey) {
    setSurvey(selectedSurvey);
    setAnswers({});
    setSavedPath('');
    setSuccess('');
    setError('');
    setLoadingResponse(true);
    try {
      const response = await localApi(`/api/local/surveys/${selectedSurvey.id}/response`);
      if (response?.answers) setAnswers(response.answers);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingResponse(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const configData = await localApi('/api/local/config');
        const isConfigured = configData.configured && !configData.configurationError;
        setConfigured(isConfigured);
        if (!isConfigured) return;

        const loadedSurveys = await localApi('/api/local/surveys');
        setSurveys(loadedSurveys);
        if (loadedSurveys[0]) await selectSurvey(loadedSurveys[0]);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }
    load();
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
      setSuccess('回答をVolputasDataへ保存しました');
      setSurveys((current) => current.map((item) => (
        item.id === survey.id
          ? {
              ...item,
              responseStatus: 'answered',
              responseUpdatedAt: result.response.updatedAt,
            }
          : item
      )));
      setSurvey((current) => ({
        ...current,
        responseStatus: 'answered',
        responseUpdatedAt: result.response.updatedAt,
      }));
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
  if (surveys.length === 0) {
    return <div className="empty-state">利用できるアンケートがありません。</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Surveys</h2>
        <p>アンケートを選択して回答します。保存済みの回答はいつでも更新できます。</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && (
        <div className="success-message">
          {success}
          {savedPath && <div className="saved-path">{savedPath}</div>}
        </div>
      )}

      <div className="surveys-layout">
        <aside className="card survey-list">
          <h3>アンケート一覧</h3>
          <div className="survey-items">
            {surveys.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`survey-item ${survey?.id === item.id ? 'active' : ''}`}
                onClick={() => selectSurvey(item)}
              >
                <div className="survey-item-header">
                  <span className="survey-title">{item.title}</span>
                  <span className={`response-status ${item.responseStatus}`}>
                    {item.responseStatus === 'answered' ? '回答済み' : '未回答'}
                  </span>
                </div>
                <div className="survey-meta">{item.questions.length}問</div>
              </button>
            ))}
          </div>
        </aside>

        <section>
          {survey && (
            <>
              <div className="card selected-survey-header">
                <div>
                  <h3>{survey.title}</h3>
                  <p>{survey.description}</p>
                </div>
                <span className={`response-status ${survey.responseStatus}`}>
                  {survey.responseStatus === 'answered' ? '回答済み' : '未回答'}
                </span>
              </div>

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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
