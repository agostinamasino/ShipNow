import { performance } from 'node:perf_hooks';
import logger from '../config/logger.js';

const routePrefixes = ['/api/products', '/api/users', '/api/orders', '/api/files', '/api/mocks', '/api/logger-test'];
const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'];

function routeTemplate(req, prefix) {
  if (!req.route) return 'UNMATCHED_ROUTE';
  if (typeof req.route.path !== 'string') return 'KNOWN_ROUTE';
  // El router de archivos se monta en /api y ya incluye users/orders en su plantilla.
  if (prefix.startsWith('/api/') && req.route.path.startsWith(prefix.slice(4) + '/')) {
    return '/api' + req.route.path;
  }
  return prefix + req.route.path;
}

export function httpLogger(req, res, next) {
  const startedAt = performance.now();
  // Express restaura baseUrl al salir de un router hacia el manejador global.
  // Se conserva solo una etiqueta de la lista fija, nunca el path recibido.
  const path = typeof req.path === 'string' ? req.path.toLowerCase() : '';
  const prefix = routePrefixes.find(prefix => path === prefix || path.startsWith(prefix + '/')) ?? '';
  res.once('finish', () => {
    const method = httpMethods.includes(req.method) ? req.method : 'OTHER';
    const durationMs = (performance.now() - startedAt).toFixed(2);
    logger.http(`HTTP_REQUEST method=${method} route=${routeTemplate(req, prefix)} status=${res.statusCode} durationMs=${durationMs}`);
  });
  return next();
}
