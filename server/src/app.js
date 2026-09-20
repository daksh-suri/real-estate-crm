const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const config = require('./config');
const healthRoute = require('./routes/health');
const authRoutes = require('./modules/auth/routes');
const demoAuthzRoutes = require('./modules/authorization/demoRoutes');
const organizationRoutes = require('./modules/organizations/routes');
const teamRoutes = require('./modules/teams/routes');
const userTeamsRoutes = require('./modules/teams/userTeamsRoutes');
const contactRoutes = require('./modules/contacts/routes');
const requirementRoutes = require('./modules/requirements/routes');
const { projectRouter, unitRouter } = require('./modules/property/routes');
const enquiryRoutes = require('./modules/enquiries/routes');
const leadRoutes = require('./modules/leads/routes');
const leadSourceRoutes = require('./modules/leadSources/routes');
const campaignRoutes = require('./modules/campaigns/routes');
const assignmentRuleRoutes = require('./modules/assignmentRules/routes');
const dealRoutes = require('./modules/deals/routes');
const siteVisitRoutes = require('./modules/siteVisits/routes');
const reservationRoutes = require('./modules/reservations/routes');
const bookingRoutes = require('./modules/bookings/routes');
const documentRoutes = require('./modules/documents/routes');
const { activitiesRouter, tasksRouter } = require('./modules/activities/routes');
const { planRouter, obligationRouter, recordRouter, webhookRouter } = require('./modules/payments/routes');
const reportRoutes = require('./modules/reports/routes');
const dashboardRoutes = require('./modules/dashboard/routes');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Base security & cross-origin middleware
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

// Logging middleware (disabled in test)
if (!config.isTest) {
  app.use(morgan('dev'));
}

// Body & cookie parsing middleware. rawBody is captured for HMAC webhook
// verification (verified against the exact signed bytes, not re-serialized
// JSON); all other consumers keep using the parsed body. The 100kb cap is
// explicit (express default) and sits well above the 20KB rawPayload ceiling.
app.use(cookieParser());
app.use(
  express.json({
    limit: '100kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Core foundation routes
app.use('/health', healthRoute);
app.use('/auth', authRoutes);
app.use('/organizations', organizationRoutes);
app.use('/teams', teamRoutes);
app.use('/users', userTeamsRoutes);
app.use('/contacts', contactRoutes);
app.use('/requirements', requirementRoutes);
app.use('/projects', projectRouter);
app.use('/units', unitRouter);
app.use('/enquiries', enquiryRoutes);
app.use('/leads', leadRoutes);
app.use('/lead-sources', leadSourceRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/assignment-rules', assignmentRuleRoutes);
app.use('/deals', dealRoutes);
app.use('/site-visits', siteVisitRoutes);
app.use('/reservations', reservationRoutes);
app.use('/bookings', bookingRoutes);
app.use('/documents', documentRoutes);
app.use('/activities', activitiesRouter);
app.use('/tasks', tasksRouter);
app.use('/payment-plans', planRouter);
app.use('/payment-obligations', obligationRouter);
app.use('/payment-records', recordRouter);
app.use('/webhooks', webhookRouter);
app.use('/dashboard', dashboardRoutes);
app.use('/reports', reportRoutes);
app.use('/protected', demoAuthzRoutes);

// 404 handler
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;
