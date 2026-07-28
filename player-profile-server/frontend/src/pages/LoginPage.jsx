import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    if (!ticket) return;
    let active = true;
    setLoading(true);
    api('/auth/ticket', { method: 'POST', body: { ticket } })
      .then(async (response) => {
        if (!active) return;
        window.history.replaceState(null, '', '/auth/complete');
        await login(response.data.access_token, response.data.refresh_token);
        navigate('/');
      })
      .catch(() => {
        if (active) setError('Authentication failed or the login ticket expired');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [login, navigate]);

  async function handleProviderLogin(provider) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/auth/login?provider=${provider}`);
      const json = await res.json();
      if (json.ok) {
        window.location.href = json.data.authorizationUrl;
      } else {
        setError(json.error?.message || 'Failed to start login');
        setLoading(false);
      }
    } catch {
      setError('Failed to start login');
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-header">
          <h1>Volputas</h1>
          <p>Cernereアカウントでオンラインモードへログイン</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="login-buttons">
          <button
            className="provider-btn cernere"
            onClick={() => handleProviderLogin('cernere')}
            disabled={loading}
          >
            <span className="provider-icon">C</span>
            Cernereでログイン
          </button>
        </div>
      </div>
    </div>
  );
}
