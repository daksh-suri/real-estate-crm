const {
  validate,
  createDocumentSchema,
  documentIdParamSchema,
  rejectSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function create(req, res, next) {
  try {
    const input = validate(createDocumentSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.createDocument({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      idempotencyKey: key,
      input,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof IdempotentReplay) {
      return res.status(200).json(err.snapshot);
    }
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listDocuments({
      tenantPrisma: req.tenantPrisma,
      filters: {
        contactId: query.contactId,
        dealId: query.dealId,
        groupId: query.groupId,
        status: query.status,
        type: query.type,
      },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const row = await service.getDocument({ tenantPrisma: req.tenantPrisma, documentId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function uploadUrl(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const result = await service.getUploadUrl({ tenantPrisma: req.tenantPrisma, documentId });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function accessUrl(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const result = await service.getAccessUrl({ tenantPrisma: req.tenantPrisma, documentId });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function complete(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const row = await service.completeUpload({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      documentId,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function submit(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const row = await service.submitForReview({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      documentId,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function verify(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const row = await service.verifyDocument({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      documentId,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function reject(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const { rejectionReason } = validate(rejectSchema, req.body);
    const row = await service.rejectDocument({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      documentId,
      rejectionReason,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function resubmit(req, res, next) {
  try {
    const { documentId } = validate(documentIdParamSchema, req.params);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.resubmitDocument({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      idempotencyKey: key,
      documentId,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof IdempotentReplay) {
      return res.status(200).json(err.snapshot);
    }
    return next(err);
  }
}

module.exports = { create, list, getOne, uploadUrl, accessUrl, complete, submit, verify, reject, resubmit };
