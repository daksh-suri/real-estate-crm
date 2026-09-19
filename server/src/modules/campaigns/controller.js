const {
  validate,
  createCampaignSchema,
  updateCampaignSchema,
  campaignIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const data = validate(createCampaignSchema, req.body);
    const row = await service.createCampaign({ tenantPrisma: req.tenantPrisma, organizationId: req.auth.organizationId, data });
    return res.status(201).json(row);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listCampaigns({
      tenantPrisma: req.tenantPrisma,
      search: query.search,
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
    const { campaignId } = validate(campaignIdParamSchema, req.params);
    const row = await service.getCampaign({ tenantPrisma: req.tenantPrisma, campaignId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { campaignId } = validate(campaignIdParamSchema, req.params);
    const data = validate(updateCampaignSchema, req.body);
    const updated = await service.updateCampaign({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      campaignId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { campaignId } = validate(campaignIdParamSchema, req.params);
    const deleted = await service.deleteCampaign({ tenantPrisma: req.tenantPrisma, campaignId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, update, remove };
