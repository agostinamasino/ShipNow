import config from './config/index.js';
import express from 'express';
import productsRouter from './routes/products.routes.js';
import usersRouter from './routes/users.routes.js';
import ordersRouter from './routes/orders.routes.js';
import mocksRouter from './routes/mocks.routes.js';
import loggerRouter from './routes/logger.routes.js';
import { createFilesRouter } from './routes/files.routes.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import swaggerUi from 'swagger-ui-express';
import openapi from './config/swagger.js';

export function createApp({ uploadRoot } = {}) {
  const app = express();

  app.use(httpLogger);
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/mocks', mocksRouter);
  app.use('/api', createFilesRouter({ root: uploadRoot }));
  if (config.nodeEnv === 'development') {
    app.use('/api/logger-test', loggerRouter);
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    swaggerOptions: { validatorUrl: null },
  }));

  app.use(notFound);
  app.use(errorMiddleware);
  return app;
}

export default createApp();
