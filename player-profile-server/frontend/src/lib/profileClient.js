import { useMemo } from 'react';
import { useRuntimeMode } from '../hooks/useRuntimeMode';
import { api, apiUpload } from './api';
import { localApi, localUpload } from './localApi';

function createProfileClient(mode) {
  const isLocal = mode === 'local';
  const base = isLocal ? '/api/local' : '/api/v1/profile-data';
  const request = isLocal ? localApi : async (path, options) => {
    const result = await api(path, options);
    return result.data;
  };
  const upload = isLocal ? localUpload : apiUpload;

  return {
    list(kind) {
      return request(`${base}/${kind}`);
    },
    create(kind, body) {
      return request(`${base}/${kind}`, { method: 'POST', body });
    },
    upload(kind, recordId, file) {
      return upload(`${base}/media/${kind}/${recordId}`, file);
    },
    personaStatus() {
      return request(`${base}/persona`);
    },
    analyzePersona() {
      return request(`${base}/persona/analyze`, { method: 'POST' });
    },
    importPopulationReport(report) {
      if (!isLocal) {
        return Promise.reject(new Error('母集団レポートの取込はローカルモード専用です。'));
      }
      return request(`${base}/persona/population-report`, { method: 'POST', body: report });
    },
    personaHistory() {
      // Analysis history is Git-backed and local-only for now; the online
      // history table is a follow-up task.
      if (!isLocal) return Promise.resolve([]);
      return request(`${base}/persona/history`);
    },
    comparisonDeck() {
      return request(`${base}/comparisons/deck`);
    },
    evaluateEmotionCurve(recordId) {
      return request(`${base}/emotion-curves/${recordId}/evaluate`, { method: 'POST' });
    },
    async mediaUrl(kind, recordId) {
      if (isLocal) return `${base}/media/${kind}/${recordId}`;
      const result = await request(`${base}/media/${kind}/${recordId}/ticket`);
      return result.url;
    },
  };
}

export function useProfileClient() {
  const { mode } = useRuntimeMode();
  return useMemo(() => createProfileClient(mode), [mode]);
}

export { createProfileClient };
