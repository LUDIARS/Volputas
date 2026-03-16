import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, setTokens } from '../lib/api';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle callback with code & state in URL
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (code && state && !loading) {
    handleCallback(code, state);
  }

  async function handleCallback(code, state) {
    setLoading(true);
    try {
      const res = await fetch(`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
      const json = await res.json();
      if (json.ok) {
        login(json.data.access_token, json.data.refresh_token);
        navigate('/');
      } else {
        setError(json.error?.message || 'Authentication failed');
      }
    } catch {
      setError('Authentication failed');
    } finally {
      setLoading(false);
    }
  }

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

  // Demo login (for development without IdP)
  async function handleDemoLogin() {
    setLoading(true);
    setError('');
    try {
      const res = await api('/auth/token', {
        method: 'POST',
        body: { code: 'demo', code_verifier: 'demo', provider: 'google' },
      });
      login(res.data.access_token, res.data.refresh_token);
      navigate('/');
    } catch (err) {
      setError('Demo login unavailable — configure an OAuth provider');
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-header">
          <h1>Player Profile</h1>
          <p>Sign in to manage your gaming identity</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="login-buttons">
          <button
            className="provider-btn google"
            onClick={() => handleProviderLogin('google')}
            disabled={loading}
          >
            <span className="provider-icon">G</span>
            Sign in with Google
          </button>

          <button
            className="provider-btn discord"
            onClick={() => handleProviderLogin('discord')}
            disabled={loading}
          >
            <span className="provider-icon">D</span>
            Sign in with Discord
          </button>

          <button
            className="provider-btn steam"
            onClick={() => handleProviderLogin('steam')}
            disabled={loading}
          >
            <span className="provider-icon">S</span>
            Sign in with Steam
          </button>
        </div>

        <div className="login-divider"><span>or</span></div>

        <button
          className="btn-outline demo-btn"
          onClick={handleDemoLogin}
          disabled={loading}
        >
          Demo Login (Development)
        </button>
      </div>
    </div>
  );
}
