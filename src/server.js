import app from './app.js';
import config from './config/index.js';
import mongoose from 'mongoose';
import logger from './config/logger.js';

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
