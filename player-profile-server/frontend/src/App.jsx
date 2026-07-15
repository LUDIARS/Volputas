import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import SessionsPage from './pages/SessionsPage';
import SurveysPage from './pages/SurveysPage';
import AnalysisPage from './pages/AnalysisPage';
import SettingsPage from './pages/SettingsPage';
import ImpressionPage from './pages/ImpressionPage';
import VideoReviewUploadPage from './pages/VideoReviewUploadPage';

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            path="/auth/complete"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="surveys" element={<SurveysPage />} />
            <Route path="analysis" element={<AnalysisPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="impressions/:id" element={<ImpressionPage />} />
            <Route path="video-reviews/new" element={<VideoReviewUploadPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
