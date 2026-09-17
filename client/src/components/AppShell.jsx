import { useState, useEffect } from 'react';

export default function AppShell() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/health');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
    } catch (err) {
      setError(err.message || 'Failed to connect to backend');
      setHealthData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-container">
          <div className="brand">
            <div className="brand-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div className="brand-info">
              <span className="brand-title">Vynexa CRM</span>
              <span className="brand-subtitle">Project Foundation</span>
            </div>
          </div>
          <div className="header-badge">
            <span className="status-dot"></span>
            <span>Checkpoint 1: Initialized</span>
          </div>
        </div>
      </header>

      <main className="main-container">
        <section className="hero-section">
          <div className="hero-pill">
            <span>Modular Monolith Foundation</span>
          </div>
          <h1 className="hero-title">Real Estate CRM Engine</h1>
          <p className="hero-description">
            Production-oriented application architecture built with React, Node.js Express,
            and PostgreSQL via Prisma. Clean boundary separation established for upcoming domain checkpoints.
          </p>
        </section>

        <section className="grid-cards">
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <h2 className="card-title">Architecture Stack</h2>
              </div>
              <span className="card-badge badge-ready">Verified</span>
            </div>
            <div className="spec-list">
              <div className="spec-item">
                <span className="spec-label">Architecture</span>
                <span className="spec-value">Modular Monolith</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Language</span>
                <span className="spec-value">JavaScript (ES/Node)</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Frontend</span>
                <span className="spec-value">React 18 + Vite</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Backend</span>
                <span className="spec-value">Node.js + Express</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Database & ORM</span>
                <span className="spec-value">PostgreSQL + Prisma</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
                <h2 className="card-title">API Health Status</h2>
              </div>
              <span className={`card-badge ${healthData ? 'badge-ready' : 'badge-pending'}`}>
                {healthData ? 'Connected' : loading ? 'Checking' : 'Disconnected'}
              </span>
            </div>
            <div className="spec-list">
              <div className="spec-item">
                <span className="spec-label">Endpoint</span>
                <span className="spec-value">GET /health</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Status</span>
                <span className="spec-value">{healthData?.status || (error ? 'error' : 'offline')}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Uptime</span>
                <span className="spec-value">{healthData?.uptime ? `${healthData.uptime.toFixed(1)}s` : '—'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Timestamp</span>
                <span className="spec-value" style={{ fontSize: '0.75rem' }}>
                  {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleTimeString() : '—'}
                </span>
              </div>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button 
                type="button" 
                className="health-action-btn" 
                onClick={checkHealth}
                disabled={loading}
              >
                {loading ? 'Testing...' : 'Ping /health'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                </div>
                <h2 className="card-title">Next Checkpoint</h2>
              </div>
              <span className="card-badge badge-pending">Upcoming</span>
            </div>
            <div className="spec-list">
              <div className="spec-item">
                <span className="spec-label">Checkpoint 2</span>
                <span className="spec-value">Database Foundation</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Core Models</span>
                <span className="spec-value">Org, User, Role, Perm</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Tenant Isolation</span>
                <span className="spec-value">Prisma Extension</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Verification</span>
                <span className="spec-value">Cross-tenant leak test</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <p>Vynexa Real Estate CRM &bull; Phase 3 Implementation Blueprint &bull; Checkpoint 1 Foundation</p>
      </footer>
    </div>
  );
}
