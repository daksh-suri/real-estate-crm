import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { EntityLink } from './crm';
import { shortId } from '../../lib/format';

// Bounded related-record resolution: given a list of rows and ID fields,
// fetch each UNIQUE id once (contacts/projects/users) and render names.
// Bounded by page size, cached per mount — no per-row hooks, no N+1 renders
// storm, no global store. Falls back to a short-ID link while loading.
// Pure translation + dedupe: caller fields are { key, kind }; the endpoint
// ALWAYS comes from KINDS[kind] — never from the caller — so a request can
// never be built as /undefined/:id. Returns [{ key, endpoint, id }] with one
// entry per unique endpoint:id pair. Unresolvable kinds and empty ids drop.
export function buildRelatedRequests(rows, fields) {
  const wanted = new Map();
  for (const row of rows || []) {
    for (const f of fields || []) {
      const def = KINDS[f.kind];
      if (!def || !def.endpoint) continue;
      const id = row[f.key];
      if (!id) continue;
      const mapKey = `${def.endpoint}:${id}`;
      if (!wanted.has(mapKey)) wanted.set(mapKey, { key: f.key, endpoint: def.endpoint, id });
    }
  }
  return [...wanted.values()];
}

function useRelatedMap(rows, fields) {
  const { api, status } = useAuth();
  const [maps, setMaps] = useState({});

  const signature = (rows || []).map((r) => fields.map((f) => r[f.key] || '').join(':')).join('|');

  useEffect(() => {
    if (status !== 'authenticated' || !rows || rows.length === 0) {
      setMaps({});
      return undefined;
    }
    let cancelled = false;
    const wanted = buildRelatedRequests(rows, fields);
    if (wanted.length === 0) {
      setMaps({});
      return undefined;
    }
    (async () => {
      const entries = await Promise.all(
        wanted.map(async ({ endpoint, id }) => {
          try {
            const rec = await api(`/${endpoint}/${id}`);
            return [`${endpoint}:${id}`, rec];
          } catch {
            return [`${endpoint}:${id}`, null];
          }
        })
      );
      if (!cancelled) setMaps(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, signature]);

  return maps;
}

// Renders "Name" linked to the record route, or a short-ID link when the
// record is missing/unreadable. `kind` selects endpoint + route prefix.
const KINDS = {
  contact: { endpoint: 'contacts', route: (id) => `/app/contacts/${id}`, label: (r) => r.name },
  project: { endpoint: 'projects', route: (id) => `/app/properties/projects/${id}`, label: (r) => r.name },
  leadSource: { endpoint: 'lead-sources', route: () => null, label: (r) => r.name },
  campaign: { endpoint: 'campaigns', route: () => null, label: (r) => r.name },
  user: { endpoint: null, route: () => null, label: null }, // no user directory endpoint (open gap)
  lead: { endpoint: 'leads', route: (id) => `/app/leads/${id}`, label: (r) => `Lead ${shortId(r.id)}` },
  deal: { endpoint: 'deals', route: (id) => `/app/deals/${id}`, label: (r) => `Deal ${shortId(r.id)}` },
  enquiry: { endpoint: 'enquiries', route: (id) => `/app/enquiries/${id}`, label: (r) => `Enquiry ${shortId(r.id)}` },
  reservation: { endpoint: 'reservations', route: (id) => `/app/reservations/${id}`, label: (r) => `Reservation ${shortId(r.id)}` },
  booking: { endpoint: 'bookings', route: (id) => `/app/bookings/${id}`, label: (r) => `Booking ${shortId(r.id)}` },
  paymentPlan: { endpoint: 'payment-plans', route: (id) => `/app/payments/${id}`, label: (r) => `Plan ${shortId(r.id)}` },
  unit: { endpoint: 'units', route: (id) => `/app/properties/inventory/${id}`, label: (r) => r.identifier || `Unit ${shortId(r.id)}` },
};

export function RelatedName({ kind, id, maps }) {
  const def = KINDS[kind];
  if (!id || !def) return '—';
  const rec = maps ? maps[`${def.endpoint}:${id}`] : undefined;
  const to = def.route(id);
  if (rec === undefined) return <span title={id}>{shortId(id)}…</span>; // still resolving
  if (!rec) return <span title={id}>{shortId(id)}</span>; // unreadable — never leak existence
  if (!to) return <span>{def.label(rec)}</span>; // resolvable name, no detail route yet
  return <EntityLink to={to}>{def.label(rec)}</EntityLink>;
}

export function useRelatedNames(rows, fields) {
  const maps = useRelatedMap(rows, fields);
  return maps;
}

export { KINDS };
