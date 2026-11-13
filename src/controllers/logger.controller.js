import logger from '../config/logger.js';

export function loggerTest(req, res) {
  logger.debug('LOGGER_DEMO_DEBUG');
  logger.http('LOGGER_DEMO_HTTP');
  logger.info('LOGGER_DEMO_INFO');
  logger.warning('LOGGER_DEMO_WARNING');
  logger.error('LOGGER_DEMO_ERROR');
  logger.fatal('LOGGER_DEMO_FATAL');
  return res.json({ status: 'ok' });
}
