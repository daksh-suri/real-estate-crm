import { Link } from 'react-router-dom';
import './crm.css';
import { Badge } from '../ui/controls';

// Domain status → badge tone. Unknown statuses fall back to neutral — never
// crash on a value a future checkpoint introduces.
const STATUS_TONES = {
  OPEN: 'info',
  ACTIVE: 'success',
  AVAILABLE: 'success',
  SCHEDULED: 'info',
  CONFIRMED: 'success',
  VERIFIED: 'success',
  PAID: 'success',
  SUCCESS: 'success',
  PENDING: 'warning',
  ON_HOLD: 'warning',
  UNDER_REVIEW: 'warning',
  SUBMITTED: 'warning',
  RESUBMITTED: 'warning',
  UNASSIGNED: 'warning',
  OVERDUE: 'destructive',
  REJECTED: 'destructive',
  FAILED: 'destructive',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  RELEASED: 'neutral',
  CONVERTED: 'neutral',
  DISQUALIFIED: 'neutral',
  CLOSED_WON: 'success',
  CLOSED_LOST: 'neutral',
  BOOKED: 'success',
  RESERVED: 'info',
  DONE: 'success',
};

export function StatusBadge({ status }) {
  const tone = STATUS_TONES[String(status)] || 'neutral';
  return <Badge tone={tone}>{String(status).replace(/_/g, ' ')}</Badge>;
}

export function StatTile({ label, value, hint }) {
  return (
    <div className="stat-tile">
      <p className="stat-tile__label">{label}</p>
      <p className="stat-tile__value">{value}</p>
      {hint && <p className="stat-tile__hint">{hint}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <input
      type="search"
      className="field search-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}

// FilterBar: search + arbitrary filter controls + optional primary action.
// Later screens pass their own Selects as children; layout stays consistent.
export function FilterBar({ searchValue, onSearch, searchPlaceholder, children, action }) {
  return (
    <div className="filter-bar">
      {onSearch && <SearchInput value={searchValue ?? ''} onChange={onSearch} placeholder={searchPlaceholder} />}
      {children}
      {action && <div className="filter-bar__action">{action}</div>}
    </div>
  );
}

// EntityLink: internal link to a CRM record. `to` is always an app route —
export function EntityLink({ to, children }) {
  return (
    <Link className="entity-link" to={to}>
      {children}
    </Link>
  );
}
