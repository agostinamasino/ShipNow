import { AppError } from '../errors/app-error.js';

export function notFound(req, res, next) {
  return next(new AppError('ROUTE_NOT_FOUND'));
}
