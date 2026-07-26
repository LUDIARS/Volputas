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
