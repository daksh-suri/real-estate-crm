// Display formatting. Dates render in the viewer's locale with a stable
// shape; IDs shorten for dense tables (full ID stays in links/titles).
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function shortId(id) {
  if (!id) return '—';
  return String(id).slice(0, 8);
}

export function prettifyEnum(value) {
  if (value == null) return '—';
  return String(value).replace(/_/g, ' ');
}

export function formatMoney(amount, currency = '₹') {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  return `${currency}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
