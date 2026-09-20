// Frontend mirror of the backend lead ALLOWED_TRANSITIONS map
// (server leads/service.js). Only these targets are ever offered in the UI —
// no generic status dropdown exists. If the backend map changes, this file
// and its test must change with it.
export const LEAD_TRANSITIONS = Object.freeze({
  OPEN: Object.freeze(['CONVERTED', 'DISQUALIFIED']),
  DISQUALIFIED: Object.freeze(['OPEN']),
  CONVERTED: Object.freeze([]),
});

export function validLeadTransitions(status) {
  return [...(LEAD_TRANSITIONS[status] || [])];
}
