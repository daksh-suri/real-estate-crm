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

// Body & cookie parsing middleware
app.use(cookieParser());
app.use(express.json());
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
app.use('/protected', demoAuthzRoutes);

// 404 handler
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;
