import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import SurveyNavigation from './SurveyNavigation';
import { localApi } from '../lib/localApi';

export default function LocalLayout() {
  const [surveys, setSurveys] = useState([]);
  const [surveysLoading, setSurveysLoading] = useState(true);
  const [configured, setConfigured] = useState(false);

  const reloadSurveys = useCallback(async () => {
    setSurveysLoading(true);
    try {
      const config = await localApi('/api/local/config');
      const isConfigured = config.configured && !config.configurationError;
      setConfigured(isConfigured);
      setSurveys(isConfigured ? await localApi('/api/local/surveys') : []);
    } finally {
      setSurveysLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadSurveys().catch(() => {
      setSurveys([]);
      setConfigured(false);
    });
  }, [reloadSurveys]);

  function markSurveyAnswered(surveyId, responseUpdatedAt) {
    setSurveys((current) => current.map((survey) => (
      survey.id === surveyId
        ? { ...survey, responseStatus: 'answered', responseUpdatedAt }
        : survey
    )));
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Volputas</h1>
          <div className="subtitle">Local Survey Tool</div>
        </div>

        <nav className="sidebar-nav">
          <SurveyNavigation surveys={surveys} loading={surveysLoading} />
          <div className="local-nav-section">体験データ</div>
          <NavLink to="/gameplay"><span className="nav-icon">▣</span><span>ゲームプレイ情報</span></NavLink>
          <NavLink to="/voices"><span className="nav-icon">◖</span><span>ユーザの声</span></NavLink>
          <NavLink to="/emotion-curves"><span className="nav-icon">⌁</span><span>感情曲線</span></NavLink>
          <NavLink to="/comparisons"><span className="nav-icon">⚖</span><span>どっちが好き?</span></NavLink>
          <NavLink to="/card-sort"><span className="nav-icon">▤</span><span>カードソート</span></NavLink>
          <NavLink to="/pitches"><span className="nav-icon">✎</span><span>理想のゲーム企画</span></NavLink>
          <div className="local-nav-section">自分を知る</div>
          <NavLink to="/persona"><span className="nav-icon">◇</span><span>ペルソナ分析</span></NavLink>
        </nav>

        <div className="sidebar-user local-mode-footer">
          <div className="avatar">L</div>
          <div className="user-info">
            <div className="user-name">LOCAL ONLY</div>
          </div>
          <NavLink className="settings-link" to="/settings" aria-label="Settings" title="Settings">
            &#9881;
          </NavLink>
        </div>
      </aside>

      <main className="main-content">
        <Outlet context={{
          configured,
          markSurveyAnswered,
          reloadSurveys,
          surveys,
          surveysLoading,
        }} />
      </main>
    </div>
  );
}
