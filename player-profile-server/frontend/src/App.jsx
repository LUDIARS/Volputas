import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LocalLayout from './components/LocalLayout';
import LocalSettingsPage from './pages/LocalSettingsPage';
import LocalSurveysPage from './pages/LocalSurveysPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<LocalLayout />}>
          <Route index element={<Navigate to="/surveys" replace />} />
          <Route path="surveys" element={<LocalSurveysPage />} />
          <Route path="settings" element={<LocalSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/surveys" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
