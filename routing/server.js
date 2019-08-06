const nextjs = require('next');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const debug = require('debug')('cw:server');
const express = require('express');
const basicAuth = require('express-basic-auth');
const xmlSitemapProxy = require('./xmlsitemap');
const internalRoutes = require('./internalRoutes');

const startFalconServer = (nextConfig = {}, expressServer = express()) => new Promise((resolve, reject) => {

  const application = nextjs(nextConfig);
  application
    .prepare()
    .then(() => {

      const expressServer = applyFalconRoutingConfiguration(application);
      expressServer.use(favicon(`${__dirname}/static/favicon.ico`));
      expressServer.use('/_clear', clearCache);
      expressServer.use(globalSettingsForApp(application, process.env.APPLICATION_NAME));
      expressServer.use(handleHomepageRequest);
      expressServer.use(frontendOnlyRoutes(application, routes));

      // Handle all other requests using our custom router which is a mix
      // or original Next.js logic and Drupal routing logic.
      expressServer.get('*', (req, res) => decoupledRouter(req, res, application));

      resolve(expressServer);

    })
    .catch(error => reject(error));
});


const defaultConfig = {};

const falconApp = (nextConfig = {}) => {
  // TODO: MERGE WITH DEFAULT CONFIG.
  const app = nextjs(nextConfig);

  return app.prepare();
};

const applyFalconRoutingConfiguration = (app, expressServer = express()) => {


  // Make sure we enable http auth only on dev environments.
  if (process.env.ENVIRONMENT && (process.env.ENVIRONMENT === 'development')) {
    // Make sure that we do have http user & password set in variables.
    if (process.env.HTTP_AUTH_USER && process.env.HTTP_AUTH_PASS) {
      expressServer.use(basicAuth({
        users: {
          [process.env.HTTP_AUTH_USER]: process.env.HTTP_AUTH_PASS,
        },
        challenge: true,
      }));
    }
  }

  // A little middleware that helps to parse the incoming cookies.
  expressServer.use(cookieParser());

  // Serve gzipped content where possible.
  expressServer.use(compression());

  // Set browser caching for all static files of the app.
  expressServer.use('/static', express.static(`${app.dir}/static`, {
    maxAge: process.env.STATIC_CACHE_MAX_AGE || '7d',
    fallthrough: false,
  }));

  // Set browser caching for all static files generated by Next.js.
  expressServer.use('/_next/static', express.static(`${app.dir}/.next/static`, {
    maxAge: process.env.STATIC_CAHCE_MAX_AGE || '7d',
    fallthrough: false,
  }));

  expressServer.get('/sitemap.xml', async (req, res) => xmlSitemapProxy(req, res, app, process.env.SITEMAP_NAME));

  // Fail fast on any express handler error.
  expressServer.use((err, req, res, next) => {
    debug('Express.js handler error: %o', err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(err.statusCode).send(err.statusCode === 404 ? 'Page not found' : 'An unexpected error occurred');
  });

  expressServer.use(internalRoutes(app));
  expressServer.use((req, res, next) => {
    res.falcon = {};
    next();
  });

  expressServer.use(globalSettingsForApp(app, process.env.APPLICATION_NAME));
  expressServer.use(handleHomepageRequest);
  expressServer.use(frontendOnlyRoutes(app, routes));

  expressServer.use('/_clear', clearCache);
  // Handle all other requests using our custom router which is a mix
  // or original Next.js logic and Drupal routing logic.
  expressServer.get('*', (req, res) => decoupledRouter(req, res, app));

  return expressServer;
};

module.exports = {
  applyFalconRoutingConfiguration,
  falconApp,
};
