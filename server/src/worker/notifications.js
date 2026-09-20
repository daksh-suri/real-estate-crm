// Notification lanes (Checkpoint 15). No provider integrations exist in V1:
// delivery goes through an injected provider (tests) or the log provider
// (dev — records intent, never claims external delivery). Customer-facing
// sends re-read consent at dispatch time; internal sends never consult it.
const { createTenantPrisma } = require('../lib/tenant');

const LANES = {
  INTERNAL: 'internal',
  CUSTOMER: 'customer',
};

let provider = null;
function setNotificationProvider(p) {
  provider = p;
}

const logProvider = {
  async send({ eventId, lane, contact, subject, body }) {
    console.log(
      JSON.stringify({
        worker: 'notify',
        eventId,
        lane,
        contactId: contact ? contact.id : null,
        subject,
        delivered: false,
        note: 'log provider only — no external send',
      })
    );
    void body;
    return { delivered: false };
  },
};

function activeProvider() {
  return provider || logProvider;
}

async function dispatchNotification(event, { client } = {}) {
  void client;
  const payload = event.payload || {};
  const { lane, contactId, subject, body } = payload;
  if ((lane !== LANES.INTERNAL && lane !== LANES.CUSTOMER) || typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
    const err = new Error(`Unprocessable notification payload for event ${event.id}`);
    err.statusCode = 400;
    throw err;
  }

  let contact = null;
  if (contactId) {
    const tenantPrisma = createTenantPrisma(event.organizationId);
    contact = await tenantPrisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) {
      const err = new Error(`Notification contact ${contactId} not found`);
      err.statusCode = 404;
      throw err;
    }
  }

  // Consent-at-dispatch (Phase 2): re-read current state here, never trust
  // the enqueue-time snapshot. Internal lane skips the gate entirely.
  if (lane === LANES.CUSTOMER) {
    if (!contact) {
      const err = new Error('Customer notification requires a contact');
      err.statusCode = 400;
      throw err;
    }
    if (contact.communicationConsent === 'OPTED_OUT') {
      return { suppressed: true, reason: 'contact OPTED_OUT at dispatch' };
    }
  }

  // Stable key across retries: the provider must not send twice for one event.
  await activeProvider().send({ eventId: event.id, lane, contact, subject, body });
  return { delivered: true };
}

module.exports = {
  LANES,
  logProvider,
  setNotificationProvider,
  dispatchNotification,
};
