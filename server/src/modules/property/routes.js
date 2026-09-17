const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../authorization/guard');
const controller = require('./controller');

const projectRouter = express.Router();
const unitRouter = express.Router();

projectRouter.use(authenticate);
unitRouter.use(authenticate);

// Projects
projectRouter.post('/', authorize('project', 'create'), controller.createProject);
projectRouter.get('/', authorize('project', 'read'), controller.listProjects);
projectRouter.get('/:projectId', authorize('project', 'read'), controller.getProject);
projectRouter.patch('/:projectId', authorize('project', 'update'), controller.updateProject);
projectRouter.delete('/:projectId', authorize('project', 'delete'), controller.deleteProject);

// Nested units
projectRouter.post('/:projectId/units', authorize('unit', 'create'), controller.createUnit);
projectRouter.get('/:projectId/units', authorize('unit', 'read'), controller.listUnitsForProject);

// Direct units
unitRouter.get('/', authorize('unit', 'read'), controller.listUnits);
unitRouter.get('/:unitId', authorize('unit', 'read'), controller.getUnit);
unitRouter.patch('/:unitId', authorize('unit', 'update'), controller.updateUnit);
unitRouter.delete('/:unitId', authorize('unit', 'delete'), controller.deleteUnit);

module.exports = { projectRouter, unitRouter };
