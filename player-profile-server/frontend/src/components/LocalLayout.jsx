import { NavLink, Outlet } from 'react-router-dom';

export default function LocalLayout() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Volputas</h1>
          <div className="subtitle">Local Survey Tool</div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/surveys">
            <span className="nav-icon">&#9998;</span>
            <span>Surveys</span>
          </NavLink>
          <NavLink to="/settings">
            <span className="nav-icon">&#9881;</span>
            <span>Settings</span>
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <div className="avatar">L</div>
          <div className="user-info">
            <div className="user-name">Local only</div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
