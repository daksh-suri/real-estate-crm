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

// datetime-local input helpers. toInputValue renders a Date/ISO string as
// the local "YYYY-MM-DDTHH:mm" the input needs; fromInputValue parses it
// back to an ISO string for the API. Empty/invalid round-trips to null.
export function toInputValue(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromInputValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
