import { AppError } from '../errors/app-error.js';
import { ERROR_CATALOG } from '../errors/error.catalog.js';
import logger from '../config/logger.js';
import { diagnosticMetadata } from '../config/error-diagnostic.js';

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);

  let entry = ERROR_CATALOG.INTERNAL_ERROR;
  if (err instanceof AppError && Object.hasOwn(ERROR_CATALOG, err.code)) {
    entry = ERROR_CATALOG[err.code];
  } else if (err instanceof SyntaxError && err.type === 'entity.parse.failed' && err.status === 400) {
    entry = ERROR_CATALOG.INVALID_JSON;
  } else if (err?.type === 'entity.too.large' && err.status === 413) {
    entry = ERROR_CATALOG.PAYLOAD_TOO_LARGE;
  }

  const severity = entry.status === 500 ? 'error' : 'warning';
  const event = `HTTP_ERROR code=${entry.code} status=${entry.status}`;
  if (severity === 'error') logger.error(event, diagnosticMetadata(err));
  else logger.warning(event);

  const error = { code: entry.code, message: entry.message };
  if (err instanceof AppError && err.details && entry.code !== 'INTERNAL_ERROR') {
    error.details = err.details;
  }

  return res.status(entry.status).json({ success: false, error });
}
