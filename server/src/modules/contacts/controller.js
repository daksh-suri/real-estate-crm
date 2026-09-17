const { validate, createContactSchema, updateContactSchema, contactIdParamSchema, listQuerySchema, mergeSchema } = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const data = validate(createContactSchema, req.body);
    const result = await service.createContact({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      data,
    });
    // If possible duplicates were created, include them in response for agent review
    return res.status(201).json({
      contact: result.contact,
      possibleDuplicates: result.possibleDuplicates,
      matchType: result.matchType,
    });
  } catch (err) {
    // Strong duplicate case already has 409 with existingContact
    if (err.statusCode === 409 && err.existingContact) {
      return res.status(409).json({
        error: { message: err.message, status: 409, existingContact: err.existingContact, matchType: err.matchType },
      });
    }
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const contact = await service.getContact({ tenantPrisma: req.tenantPrisma, contactId });
    return res.json(contact);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const contacts = await service.listContacts({
      tenantPrisma: req.tenantPrisma,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(contacts);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const data = validate(updateContactSchema, req.body);
    const updated = await service.updateContact({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      contactId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    if (err.statusCode === 409 && err.existingContact) {
      return res.status(409).json({
        error: { message: err.message, status: 409, existingContact: err.existingContact },
      });
    }
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const deleted = await service.deleteContact({ tenantPrisma: req.tenantPrisma, contactId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

async function merge(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const { targetId } = validate(mergeSchema, req.body);
    // contactId is duplicate (loser), targetId is survivor
    const result = await service.mergeContacts({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      survivorId: targetId,
      duplicateId: contactId,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function listPossibleDuplicates(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    // Verify contact belongs to org first
    await service.getContact({ tenantPrisma: req.tenantPrisma, contactId });
    const dups = await req.tenantPrisma.possibleDuplicate.findMany({
      where: {
        OR: [{ contactAId: contactId }, { contactBId: contactId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(dups);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, getOne, list, update, remove, merge, listPossibleDuplicates };
