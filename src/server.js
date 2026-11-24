import app from './app.js';
import config from './config/index.js';
import mongoose from 'mongoose';
import logger from './config/logger.js';
import { startServer } from './utils/server-lifecycle.js';

export const lifecycle = startServer({ app, database: mongoose, logger, config });
