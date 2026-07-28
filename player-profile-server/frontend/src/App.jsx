import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { RuntimeModeProvider, useRuntimeMode } from './hooks/useRuntimeMode';
import Layout from './components/Layout';
import LocalLayout from './components/LocalLayout';
import AnalysisPage from './pages/AnalysisPage';
import ComparisonPage from './pages/ComparisonPage';
import DashboardPage from './pages/DashboardPage';
import EmotionCurvePage from './pages/EmotionCurvePage';
import GameplayPage from './pages/GameplayPage';
import LocalSettingsPage from './pages/LocalSettingsPage';
import LocalSurveysPage from './pages/LocalSurveysPage';
import LoginPage from './pages/LoginPage';
import PersonaPage from './pages/PersonaPage';
import ProfilePage from './pages/ProfilePage';
import SessionsPage from './pages/SessionsPage';
import SettingsPage from './pages/SettingsPage';
import ImpressionPage from './pages/ImpressionPage';
import VideoReviewUploadPage from './pages/VideoReviewUploadPage';
import GameReviewPage from './pages/GameReviewPage';
import SurveysPage from './pages/SurveysPage';
import VoicePage from './pages/VoicePage';
import VoiceMemoPage from './pages/VoiceMemoPage';
import './styles/localProfile.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-spinner">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-spinner">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function EvidenceRoutes() {
  return (
    <>
      <Route path="gameplay" element={<GameplayPage />} />
      <Route path="voices" element={<VoicePage />} />
      <Route path="voice-memos" element={<VoiceMemoPage />} />
      <Route path="emotion-curves" element={<EmotionCurvePage />} />
      <Route path="comparisons" element={<ComparisonPage />} />
      <Route path="persona" element={<PersonaPage />} />
    </>
  );
}

function LocalRoutes() {
  return (
    <Routes>
      <Route element={<LocalLayout />}>
        <Route index element={<Navigate to="/surveys" replace />} />
        <Route path="surveys" element={<LocalSurveysPage />} />
        {EvidenceRoutes()}
        <Route path="settings" element={<LocalSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/surveys" replace />} />
    </Routes>
  );
}

function OnlineRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/auth/complete" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="surveys" element={<SurveysPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          {EvidenceRoutes()}
          <Route path="settings" element={<SettingsPage />} />
          <Route path="impressions/:id" element={<ImpressionPage />} />
          <Route path="video-reviews/new" element={<VideoReviewUploadPage />} />
          <Route path="game-reviews/new" element={<GameReviewPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function ModeRoutes() {
  const { loading, mode, error } = useRuntimeMode();
  if (loading) return <div className="loading-spinner">起動モードを確認中…</div>;
  if (error) return <div className="error-message runtime-error">{error}</div>;
  return mode === 'local' ? <LocalRoutes /> : <OnlineRoutes />;
}

export default function App() {
  return (
    <BrowserRouter>
      <RuntimeModeProvider>
        <ModeRoutes />
      </RuntimeModeProvider>
    </BrowserRouter>
  );
}
