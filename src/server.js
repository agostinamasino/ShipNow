import config from './config/index.js';
import express from 'express';
import mongoose from 'mongoose';
import productsRouter from './routes/products.routes.js';
import usersRouter from './routes/users.routes.js';
import mocksRouter from './routes/mocks.routes.js';
import loggerRouter from './routes/logger.routes.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import logger from './config/logger.js';
import swaggerUi from 'swagger-ui-express';
import openapi from './config/swagger.js';

const app = express();

app.use(httpLogger);
app.use(express.json());
app.use('/api/products', productsRouter);
app.use('/api/users', usersRouter);
app.use('/api/mocks', mocksRouter);
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

const server = app.listen(config.port, () => {
  logger.info('SERVER_LISTENING');
  mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 })
    .then(() => logger.info('MONGODB_CONNECTED'))
    .catch(() => logger.error('MONGODB_CONNECTION_FAILED'));
});

server.on('error', () => {
  logger.fatal('SERVER_LISTEN_FAILED');
  process.exitCode = 1;
});
