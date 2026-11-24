import app from './app.js';
import config from './config/index.js';
import mongoose from 'mongoose';
import logger from './config/logger.js';
import { diagnosticMetadata } from './config/error-diagnostic.js';

const server = app.listen(config.port, () => {
  logger.info('SERVER_LISTENING');
  mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 })
    .then(() => logger.info('MONGODB_CONNECTED'))
    .catch(error => logger.error('MONGODB_CONNECTION_FAILED', diagnosticMetadata(error)));
});

server.on('error', error => {
  logger.fatal('SERVER_LISTEN_FAILED', diagnosticMetadata(error));
  process.exitCode = 1;
});
