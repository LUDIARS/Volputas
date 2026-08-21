import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import SurfaceView from './panels/SurfaceView.jsx';
import { surfaceIdFromSearch } from './lib/surfaceRoute.js';
import '@volputas/charts/styles.css';
import './styles/overlay.css';

// 同じフロントが 2 役を持つ: パネル本体 (main) と情報サーフェス
// (index.html?surface=<id>)。分岐は surfaceRoute.js の純粋関数 1 つ。
const surfaceId = surfaceIdFromSearch(window.location.search);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {surfaceId ? <SurfaceView id={surfaceId} /> : <App />}
  </StrictMode>
);
