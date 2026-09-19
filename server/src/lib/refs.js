const { badRequestError, forbiddenError, notFoundError } = require('./httpError');

// Tx-bound reference resolver. Missing rows hide as 404; confirmed
// cross-tenant rows fail as 403; same-org soft-deleted rows fail as 400.
// checkActive gates User.status; checkRawDeleted=false preserves callers
// whose tenant read already encodes the deleted distinction.
async function resolveRef({ tx, organizationId, model, id, notFound, crossTenant, softDeleted, checkActive, checkRawDeleted = true }) {
  const row = await tx[model].findUnique({ where: { id } });
  if (row) {
    if (row.deletedAt) throw badRequestError(softDeleted);
    if (checkActive && row.status !== 'ACTIVE') throw badRequestError(`Cannot schedule a visit for a ${row.status} user`);
    return row;
  }
  const raw = await tx._raw[model].findUnique({ where: { id } });
  if (raw && raw.organizationId !== organizationId) throw forbiddenError(crossTenant);
  if (checkRawDeleted && raw && raw.organizationId === organizationId && raw.deletedAt) throw badRequestError(softDeleted);
  throw notFoundError(notFound);
}

module.exports = { resolveRef };
