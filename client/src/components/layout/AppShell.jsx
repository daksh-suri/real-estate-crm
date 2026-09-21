import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { NAV_GROUPS } from '../../routes/navConfig';
import { useAuth } from '../../auth/AuthContext';
import { APP_NAME } from '../../config';
import './layout.css';

function Sidebar({ collapsed, onToggle, drawerOpen, onCloseDrawer }) {
  return (
    <>
      <div
        className={`sidebar-scrim${drawerOpen ? ' sidebar-scrim--open' : ''}`}
        onClick={onCloseDrawer}
        aria-hidden="true"
      />
      <aside
        className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${drawerOpen ? ' sidebar--drawer-open' : ''}`}
        aria-label="Primary navigation"
      >
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            ⌂
          </span>
          {!collapsed && <span className="sidebar__name">{APP_NAME}</span>}
        </div>
        <nav className="sidebar__nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="sidebar__group">
              {!collapsed && <p className="sidebar__group-label">{group.label}</p>}
              {group.items.map((item) => {
                if (item.children) {
                  return (
                    <div key={item.label} className="sidebar__section">
                      {!collapsed && (
                        <p className="sidebar__section-label">
                          <span className="sidebar__icon" aria-hidden="true">{item.icon}</span>
                          <span>{item.label}</span>
                        </p>
                      )}
                      <div className="sidebar__section-items">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.path}
                            to={child.path}
                            end
                            onClick={onCloseDrawer}
                            className={({ isActive }) => `sidebar__link sidebar__link--child${isActive ? ' sidebar__link--active' : ''}`}
                            title={collapsed ? child.label : undefined}
                          >
                            <span className="sidebar__icon" aria-hidden="true">{child.icon}</span>
                            {!collapsed && <span>{child.label}</span>}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end
                    onClick={onCloseDrawer}
                    className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidebar__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </aside>
    </>
  );
}

function Header({ onMenu }) {
  const { user, organization, logout } = useAuth();
  return (
    <header className="app-header">
      <button type="button" className="app-header__menu" onClick={onMenu} aria-label="Open navigation">
        ☰
      </button>
      <div className="app-header__org" title={organization?.name}>
        {organization?.name || '—'}
      </div>
      <div className="app-header__spacer" />
      <button type="button" className="app-header__bell" aria-label="Notifications (coming soon)" title="Notifications (coming soon)">
        🔔
      </button>
      <div className="app-header__user" title={user?.email}>
        {user?.name || user?.email || '—'}
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`app${collapsed ? ' app--collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="app__main">
        <Header onMenu={() => setDrawerOpen(true)} />
        <main className="app__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
