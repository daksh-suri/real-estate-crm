// Frontend mirror of the backend deal ALLOWED_TRANSITIONS map
// (server deals/service.js) and dealStages order (validation.js). Only these
// targets are ever offered — transitions go through POST /:id/stage-transition
// exclusively. If the backend map changes, this file and its test change too.
export const DEAL_STAGES = Object.freeze([
  'NEW',
  'QUALIFIED',
  'SITE_VISIT_SCHEDULED',
  'NEGOTIATION',
  'RESERVATION',
  'BOOKING_CONFIRMED',
  'AGREEMENT_SIGNED',
  'PAYMENT_IN_PROGRESS',
  'CLOSED_WON',
  'CLOSED_LOST',
]);

const DEAL_TRANSITIONS = Object.freeze({
  NEW: ['QUALIFIED', 'CLOSED_LOST'],
  QUALIFIED: ['SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'CLOSED_LOST'],
  SITE_VISIT_SCHEDULED: ['NEGOTIATION', 'CLOSED_LOST'],
  NEGOTIATION: ['RESERVATION', 'CLOSED_LOST'],
  RESERVATION: ['BOOKING_CONFIRMED', 'CLOSED_LOST'],
  BOOKING_CONFIRMED: ['AGREEMENT_SIGNED', 'CLOSED_LOST'],
  AGREEMENT_SIGNED: ['PAYMENT_IN_PROGRESS', 'CLOSED_LOST'],
  PAYMENT_IN_PROGRESS: ['CLOSED_WON', 'CLOSED_LOST'],
  CLOSED_WON: [],
  CLOSED_LOST: [],
});

export function validDealTransitions(stage) {
  return [...(DEAL_TRANSITIONS[stage] || [])];
}

export function dealStageNeedsReason(stage) {
  return stage === 'CLOSED_LOST';
}
