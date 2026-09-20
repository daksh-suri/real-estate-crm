const {
  validate,
  createActivitySchema,
  activityIdParamSchema,
  activityListQuerySchema,
  createTaskSchema,
  taskIdParamSchema,
  taskListQuerySchema,
} = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function createActivity(req, res, next) {
  try {
    const input = validate(createActivitySchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.createActivity({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
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

async function listActivities(req, res, next) {
  try {
    const query = validate(activityListQuerySchema, req.query);
    const rows = await service.listActivities({
      tenantPrisma: req.tenantPrisma,
      filters: { contactId: query.contactId, leadId: query.leadId, dealId: query.dealId },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getActivity(req, res, next) {
  try {
    const { activityId } = validate(activityIdParamSchema, req.params);
    const row = await service.getActivity({ tenantPrisma: req.tenantPrisma, activityId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function createTask(req, res, next) {
  try {
    const input = validate(createTaskSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const task = await service.createTask({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      idempotencyKey: key,
      input,
    });
    return res.status(201).json(task);
  } catch (err) {
    if (err instanceof IdempotentReplay) {
      return res.status(200).json(err.snapshot);
    }
    return next(err);
  }
}

async function listTasks(req, res, next) {
  try {
    const query = validate(taskListQuerySchema, req.query);
    const rows = await service.listTasks({
      tenantPrisma: req.tenantPrisma,
      filters: { assignedTo: query.assignedTo, status: query.status },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getTask(req, res, next) {
  try {
    const { taskId } = validate(taskIdParamSchema, req.params);
    const row = await service.getTask({ tenantPrisma: req.tenantPrisma, taskId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function completeTask(req, res, next) {
  try {
    const { taskId } = validate(taskIdParamSchema, req.params);
    const row = await service.completeTask({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      taskId,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

module.exports = { createActivity, listActivities, getActivity, createTask, listTasks, getTask, completeTask };
