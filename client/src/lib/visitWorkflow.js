// Frontend mirror of the backend site-visit lifecycle map
// (server siteVisits/service.js). Lifecycle moves use the dedicated
// endpoints only — never a generic PATCH. Cancel requires a reason;
// reschedule is allowed from SCHEDULED/CONFIRMED via its own endpoint.
export const VISIT_STATUSES = Object.freeze(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

const VISIT_TRANSITIONS = Object.freeze({
  SCHEDULED: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
});

// Maps a valid target to its backend operation for the detail screen.
const VISIT_ACTIONS = Object.freeze({
  CONFIRMED: { endpoint: 'confirm', method: 'POST', needsReason: false, label: 'Confirm' },
  COMPLETED: { endpoint: 'complete', method: 'POST', needsReason: false, label: 'Complete' },
  CANCELLED: { endpoint: 'cancel', method: 'POST', needsReason: true, label: 'Cancel' },
  NO_SHOW: { endpoint: 'no-show', method: 'POST', needsReason: false, label: 'Mark no-show' },
});

export function validVisitTransitions(status) {
  return [...(VISIT_TRANSITIONS[status] || [])];
}

export function visitActionFor(target) {
  return VISIT_ACTIONS[target] || null;
}

export function canReschedule(status) {
  return status === 'SCHEDULED' || status === 'CONFIRMED';
}
