import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import SurveyNavigation from './SurveyNavigation';

export default function Layout() {
  const { user, logout } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [surveysLoading, setSurveysLoading] = useState(true);
  const initial = user?.display_name?.[0]?.toUpperCase() || '?';

  const reloadSurveys = useCallback(async () => {
    setSurveysLoading(true);
    try {
      const result = await api('/api/v1/surveys');
      setSurveys(result.data);
    } finally {
      setSurveysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setSurveys([]);
      setSurveysLoading(false);
      return;
    }
    reloadSurveys().catch(() => setSurveys([]));
  }, [reloadSurveys, user?.id]);

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
          <h1>Player Profile</h1>
          <div className="subtitle">Gaming Identity Platform</div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end>
            <span className="nav-icon">&#9776;</span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/profile">
            <span className="nav-icon">&#9786;</span>
            <span>Profile</span>
          </NavLink>
          <NavLink to="/sessions">
            <span className="nav-icon">&#9654;</span>
            <span>Play Logs</span>
          </NavLink>
          <NavLink to="/video-reviews/new">
            <span className="nav-icon">&#9679;</span>
            <span>Video Review</span>
          </NavLink>
          <SurveyNavigation surveys={surveys} loading={surveysLoading} />
          <div className="local-nav-section">体験データ</div>
          <NavLink to="/gameplay"><span className="nav-icon">▣</span><span>ゲームプレイ情報</span></NavLink>
          <NavLink to="/voices"><span className="nav-icon">◖</span><span>ユーザの声</span></NavLink>
          <NavLink to="/emotion-curves"><span className="nav-icon">⌁</span><span>感情曲線</span></NavLink>
          <div className="local-nav-section">自分を知る</div>
          <NavLink to="/persona"><span className="nav-icon">◇</span><span>ペルソナ分析</span></NavLink>
          <NavLink to="/analysis">
            <span className="nav-icon">&#9733;</span>
            <span>Analysis</span>
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <div className="avatar">
            {user?.avatar_url
              ? <img src={user.avatar_url} alt={user.display_name} />
              : initial}
          </div>
          <div className="user-info">
            <div className="user-name">{user?.display_name || 'Guest'}</div>
          </div>
          <NavLink className="settings-link" to="/settings" aria-label="Settings" title="Settings">
            &#9881;
          </NavLink>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet context={{ markSurveyAnswered, reloadSurveys, surveys, surveysLoading }} />
      </main>
    </div>
  );
}
