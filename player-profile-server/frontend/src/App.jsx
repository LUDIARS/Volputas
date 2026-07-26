import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LocalLayout from './components/LocalLayout';
import LocalSettingsPage from './pages/LocalSettingsPage';
import LocalSurveysPage from './pages/LocalSurveysPage';
import EmotionCurvePage from './pages/EmotionCurvePage';
import GameplayPage from './pages/GameplayPage';
import PersonaPage from './pages/PersonaPage';
import VoicePage from './pages/VoicePage';
import './styles/localProfile.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<LocalLayout />}>
          <Route index element={<Navigate to="/surveys" replace />} />
          <Route path="surveys" element={<LocalSurveysPage />} />
          <Route path="gameplay" element={<GameplayPage />} />
          <Route path="voices" element={<VoicePage />} />
          <Route path="emotion-curves" element={<EmotionCurvePage />} />
          <Route path="persona" element={<PersonaPage />} />
          <Route path="settings" element={<LocalSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/surveys" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
