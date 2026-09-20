const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

function authed() {
  const router = express.Router();
  router.use(authenticate);
  return router;
}

const activitiesRouter = authed();
const tasksRouter = authed();

// Activities are immutable history (no PATCH/DELETE by design); tasks move
// OPEN → DONE via dedicated complete only. No auto-completion, no rules.
activitiesRouter.post('/', authorize('activity', 'create'), controller.createActivity);
activitiesRouter.get('/', authorize('activity', 'read'), controller.listActivities);
activitiesRouter.get('/:activityId', authorize('activity', 'read'), controller.getActivity);
tasksRouter.post('/', authorize('task', 'create'), controller.createTask);
tasksRouter.get('/', authorize('task', 'read'), controller.listTasks);
tasksRouter.get('/:taskId', authorize('task', 'read'), controller.getTask);
tasksRouter.post('/:taskId/complete', authorize('task', 'complete'), controller.completeTask);

module.exports = { activitiesRouter, tasksRouter };
