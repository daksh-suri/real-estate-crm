import './ui.css';

// Table foundation: semantic table with sticky header; horizontal scroll is
// owned by the .table-scroll wrapper (responsive convention for all future
// data screens — never let tables overflow the viewport blindly).
export function Table({ columns, rows, rowKey, empty }) {
  if (!rows || rows.length === 0) {
    return empty || null;
  }
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Backend list endpoints return bare arrays (no totals), so `total` is
// optional. Without it, "Next" enables when hasMore (rows.length === limit)
// and the label shows "Page N" instead of "Page N of M".
export function Pagination({ limit, offset, total, hasMore, onChange }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = total == null ? null : Math.max(1, Math.ceil(total / limit));
  const canNext = pages != null ? page < pages : !!hasMore;
  if (pages != null && pages <= 1) return null;
  if (pages == null && page === 1 && !hasMore) return null;
  const goPage = (p) => onChange((p - 1) * limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>
        ← Prev
      </button>
      <span className="pagination__info" aria-live="polite">
        {pages != null ? `Page ${page} of ${pages}` : `Page ${page}`}
      </span>
      <button type="button" className="btn btn--secondary btn--sm" disabled={!canNext} onClick={() => goPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton" aria-label="Loading" role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton__line" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="state state--empty">
      <h3 className="state__title">{title}</h3>
      {message && <p className="state__message">{message}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, details, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <h3 className="state__title">Something went wrong</h3>
      <p className="state__message">{message || 'The request failed. Please try again.'}</p>
      {details && <p className="state__details">{details}</p>}
      {onRetry && (
        <div className="state__action">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
