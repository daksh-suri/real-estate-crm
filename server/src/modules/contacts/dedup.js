// Tiered matching
// Strong/clear match: both normalizedEmail and normalizedPhone present and both match existing
// Possible/ambiguous: either email OR phone matches (single signal) — different person possible (family shared number)
// No match: no signal matches

function buildMatchSignals({ normalizedEmail, normalizedPhone, name }) {
  const signals = [];
  if (normalizedEmail) signals.push('EMAIL');
  if (normalizedPhone) signals.push('PHONE');
  if (name) signals.push('NAME');
  return signals.join('+');
}

async function findStrongMatch({ tenantPrisma, normalizedEmail, normalizedPhone }) {
  if (!normalizedEmail || !normalizedPhone) return null;
  const where = {
    normalizedEmail,
    normalizedPhone,
  };
  const existing = await tenantPrisma.contact.findFirst({ where });
  return existing;
}

async function findPossibleMatches({ tenantPrisma, normalizedEmail, normalizedPhone, excludeId = null }) {
  if (!normalizedEmail && !normalizedPhone) return [];
  const orConditions = [];
  if (normalizedEmail) orConditions.push({ normalizedEmail });
  // Only add normalizedPhone to OR when non-null. When null, { normalizedPhone: null }
  // matches ALL null-phone contacts in Prisma findMany, creating false positives.
  if (normalizedPhone) orConditions.push({ normalizedPhone });

  const where = { OR: orConditions };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  const matches = await tenantPrisma.contact.findMany({ where });
  return matches;
}

module.exports = {
  buildMatchSignals,
  findStrongMatch,
  findPossibleMatches,
};
