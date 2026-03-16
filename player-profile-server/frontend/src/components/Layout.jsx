import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logout } = useAuth();

  const initial = user?.display_name?.[0]?.toUpperCase() || '?';

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Player Profile</h1>
          <div className="subtitle">Gaming Identity Platform</div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end>
            <span className="nav-icon">&#9776;</span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/profile">
            <span className="nav-icon">&#9786;</span>
            <span>Profile</span>
          </NavLink>
          <NavLink to="/sessions">
            <span className="nav-icon">&#9654;</span>
            <span>Play Logs</span>
          </NavLink>
          <NavLink to="/surveys">
            <span className="nav-icon">&#9998;</span>
            <span>Surveys</span>
          </NavLink>
          <NavLink to="/analysis">
            <span className="nav-icon">&#9733;</span>
            <span>Analysis</span>
          </NavLink>
          <NavLink to="/settings">
            <span className="nav-icon">&#9881;</span>
            <span>Settings</span>
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <div className="avatar">
            {user?.avatar_url
              ? <img src={user.avatar_url} alt={user.display_name} />
              : initial}
          </div>
          <div className="user-info">
            <div className="user-name">{user?.display_name || 'Guest'}</div>
          </div>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
