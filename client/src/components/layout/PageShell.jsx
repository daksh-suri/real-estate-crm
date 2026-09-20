import './layout.css';

// PageShell: the reusable page pattern — eyebrow context, title, description,
// right-aligned primary actions, optional KPI row, then content.
export function PageHeader({ eyebrow, title, description, actions, stats }) {
  return (
    <div className="page-header">
      <div className="page-header__main">
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
      {stats && <div className="page-header__stats">{stats}</div>}
    </div>
  );
}

export default function PageShell({ children }) {
  return <div className="page">{children}</div>;
}
