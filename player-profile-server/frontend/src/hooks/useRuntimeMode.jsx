import { createContext, useContext, useEffect, useState } from 'react';

const RuntimeModeContext = createContext(null);

export function RuntimeModeProvider({ children }) {
  const [state, setState] = useState({ loading: true, mode: null, error: '' });

  useEffect(() => {
    fetch('/api/runtime')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok || !['local', 'online'].includes(payload.data?.mode)) {
          throw new Error(payload.error?.message || 'Runtime mode is unavailable');
        }
        setState({ loading: false, mode: payload.data.mode, error: '' });
      })
      .catch((error) => {
        setState({ loading: false, mode: null, error: error.message });
      });
  }, []);

  return (
    <RuntimeModeContext.Provider value={state}>
      {children}
    </RuntimeModeContext.Provider>
  );
}

export function useRuntimeMode() {
  const context = useContext(RuntimeModeContext);
  if (!context) throw new Error('useRuntimeMode must be used within RuntimeModeProvider');
  return context;
}
