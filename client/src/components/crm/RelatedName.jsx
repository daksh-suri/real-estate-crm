import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { EntityLink } from './crm';
import { shortId } from '../../lib/format';

// Bounded related-record resolution: given a list of rows and ID fields,
// fetch each UNIQUE id once (contacts/projects/users) and render names.
// Bounded by page size, cached per mount — no per-row hooks, no N+1 renders
// storm, no global store. Falls back to a short-ID link while loading.
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
    const wanted = new Map(); // "endpoint:id" -> { endpoint, id }
    for (const row of rows) {
      for (const f of fields) {
        const id = row[f.key];
        if (id) wanted.set(`${f.endpoint}:${id}`, { endpoint: f.endpoint, id });
      }
    }
    if (wanted.size === 0) {
      setMaps({});
      return undefined;
    }
    (async () => {
      const entries = await Promise.all(
        [...wanted.values()].map(async ({ endpoint, id }) => {
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
  project: { endpoint: 'projects', route: () => '/app/properties/projects', label: (r) => r.name },
  leadSource: { endpoint: 'lead-sources', route: () => null, label: (r) => r.name },
  campaign: { endpoint: 'campaigns', route: () => null, label: (r) => r.name },
  user: { endpoint: null, route: () => null, label: null }, // no user directory endpoint (open gap)
  lead: { endpoint: 'leads', route: (id) => `/app/leads/${id}`, label: (r) => `Lead ${shortId(r.id)}` },
  enquiry: { endpoint: 'enquiries', route: (id) => `/app/enquiries/${id}`, label: (r) => `Enquiry ${shortId(r.id)}` },
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
  const resolvable = fields.filter((f) => KINDS[f.kind] && KINDS[f.kind].endpoint);
  const maps = useRelatedMap(rows, resolvable);
  return maps;
}

export { KINDS };
