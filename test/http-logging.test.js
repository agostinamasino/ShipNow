import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test, { before, after } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import logger from '../src/config/logger.js';
import { AppError } from '../src/errors/app-error.js';
import { ERROR_CATALOG } from '../src/errors/error.catalog.js';
import { httpLogger } from '../src/middlewares/http-logger.middleware.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { notFound } from '../src/middlewares/not-found.middleware.js';
import productsRouter from '../src/routes/products.routes.js';
import usersRouter from '../src/routes/users.routes.js';
import mocksRouter from '../src/routes/mocks.routes.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

const privateValue = 'PRIVATE_HTTP_VALUE';
const logDirectory = fileURLToPath(new URL('../logs/', import.meta.url));
function logSnapshot() {
  if (!existsSync(logDirectory)) return null;
  return Object.fromEntries(readdirSync(logDirectory).map(name => [
    name, readFileSync(new URL(`../logs/${name}`, import.meta.url), 'base64'),
  ]));
}
const initialLogs = logSnapshot();
let server;
let origin;

before(async () => {
  const app = express();
  app.use(httpLogger);
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/mocks', mocksRouter);
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/failure/:value', async () => {
    throw new Error(`mongodb://user:${privateValue}@host/db`);
  });
  app.get('/internal', () => { throw new AppError('INTERNAL_ERROR'); });
  app.use(notFound);
  app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  logger.close();
  assert.deepEqual(logSnapshot(), initialLogs);
});

function capture(t) {
  const events = [];
  for (const level of ['http', 'warning', 'error', 'fatal', 'info']) {
    t.mock.method(logger, level, (...args) => { events.push({ level, args }); });
  }
  return events;
}

test('resúmenes HTTP y errores 400/404/409/413/500/503 usan datos controlados y conservan JSON', async (t) => {
  const events = capture(t);
  t.mock.method(User, 'findOne', async () => ({ email: privateValue }));
  t.mock.method(Product, 'create', async data => {
    const product = new Product(data);
    await product.validate();
    return product;
  });
  assert.equal(mongoose.connection.readyState, 0);
  const cases = [
    { path: '/api/products', body: '{"name":', code: 'INVALID_JSON', route: 'UNMATCHED_ROUTE' },
    { path: '/api/products', body: JSON.stringify({ name: 'Caja', price: privateValue }),
      code: 'PRODUCT_VALIDATION_FAILED', route: '/api/products/', fields: ['price'] },
    { path: `/missing/${privateValue}?email=${privateValue}@example.com`,
      code: 'ROUTE_NOT_FOUND', route: 'UNMATCHED_ROUTE' },
    { path: '/api/users', body: JSON.stringify({ name: 'Ana', email: 'ana@example.com' }),
      code: 'USER_EMAIL_ALREADY_EXISTS', route: '/api/users/' },
    { path: '/api/mocks/seed?qty=1', body: JSON.stringify({ data: privateValue.repeat(10000) }),
      code: 'PAYLOAD_TOO_LARGE', route: 'UNMATCHED_ROUTE' },
    { path: '/api/mocks/seed?qty=1', body: '', code: 'MOCK_SEED_UNAVAILABLE', route: '/api/mocks/seed' },
    { path: `/failure/${privateValue}?password=${privateValue}`,
      code: 'INTERNAL_ERROR', route: '/failure/:value' },
    { path: '/internal', code: 'INTERNAL_ERROR', route: '/internal' },
  ];

  for (const { path, body, code, route, fields } of cases) {
    events.length = 0;
    const method = body === undefined ? 'GET' : 'POST';
    const response = await fetch(origin + path, {
      method, body, headers: { 'content-type': 'application/json', authorization: privateValue },
    });
    const entry = ERROR_CATALOG[code];
    const error = { code, message: entry.message };
    if (fields) error.details = { fields };
    assert.equal(response.status, entry.status, code);
    assert.deepEqual(await response.json(), { success: false, error });

    const summaries = events.filter(event => event.level === 'http');
    const failures = events.filter(event => ['warning', 'error', 'fatal'].includes(event.level));
    assert.equal(summaries.length, 1, code);
    assert.equal(failures.length, 1, code);
    assert.equal(summaries[0].args.length, 1);
    assert.match(summaries[0].args[0], /^HTTP_REQUEST method=(GET|POST) route=\S+ status=\d{3} durationMs=\d+\.\d{2}$/);
    assert.ok(summaries[0].args[0].includes(`route=${route} status=${entry.status} `));
    assert.deepEqual(failures[0], {
      level: code === 'INTERNAL_ERROR' ? 'error' : 'warning',
      args: [`HTTP_ERROR code=${code} status=${entry.status}`],
    });
    const serialized = JSON.stringify(events);
    for (const forbidden of [privateValue, 'ana@example.com', '?', 'mongodb://', 'authorization', 'stack']) {
      assert.ok(!serialized.includes(forbidden), forbidden);
    }
  }
});

test('las respuestas exitosas de health y mocks tienen un resumen y ninguna clasificación de error', async (t) => {
  const events = capture(t);
  for (const path of ['/health', '/api/mocks/users?qty=1', '/api/mocks/couriers?qty=1',
    '/api/mocks/orders?qty=1', '/api/mocks/deliveries?qty=1']) {
    events.length = 0;
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    const body = await response.json();
    if (path === '/health') assert.deepEqual(body, { status: 'ok' });
    else assert.equal(body[path.split('/').at(-1).split('?')[0]].length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].level, 'http');
  }
});

test('el middleware instala un solo listener de finish y lo ejecuta una sola vez', (t) => {
  const events = capture(t);
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = { method: 'CUSTOM_PRIVATE_METHOD', baseUrl: privateValue, route: { path: '/safe/:id' } };
  let nextCalls = 0;
  httpLogger(req, res, () => { nextCalls++; });
  assert.equal(nextCalls, 1);
  assert.equal(res.listenerCount('finish'), 1);
  assert.equal(res.listenerCount('close'), 0);
  res.emit('finish');
  res.emit('finish');
  assert.equal(events.length, 1);
  assert.match(events[0].args[0], /method=OTHER route=\/safe\/:id /);
  assert.equal(res.listenerCount('finish'), 0);
});

for (const scenario of ['connected', 'disconnected', 'listen-failed']) {
  test(`arranque registra eventos seguros para ${scenario}`, () => {
    const source = `
      import express from 'express';
      import mongoose from 'mongoose';
      import { EventEmitter } from 'node:events';
      import logger from './src/config/logger.js';
      const events = [];
      for (const level of ['info', 'error', 'fatal']) {
        logger[level] = (...args) => events.push({ level, args });
      }
      mongoose.connect = async () => {
        if (${JSON.stringify(scenario)} === 'disconnected') {
          throw new Error('mongodb://PRIVATE_CONNECTION_VALUE');
        }
      };
      express.application.listen = function (port, callback) {
        const server = new EventEmitter();
        queueMicrotask(() => {
          if (${JSON.stringify(scenario)} === 'listen-failed') {
            server.emit('error', new Error('PRIVATE_LISTEN_VALUE'));
          } else callback();
        });
        return server;
      };
      await import('./src/server.js');
      await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ events, exitCode: process.exitCode ?? 0 }));
      process.exitCode = 0;
      logger.close();
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, NODE_ENV: 'test', PORT: '3000', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const expected = scenario === 'listen-failed'
      ? [{ level: 'fatal', args: ['SERVER_LISTEN_FAILED'] }]
      : [{ level: 'info', args: ['SERVER_LISTENING'] }, {
        level: scenario === 'connected' ? 'info' : 'error',
        args: [scenario === 'connected' ? 'MONGODB_CONNECTED' : 'MONGODB_CONNECTION_FAILED'],
      }];
    assert.deepEqual(JSON.parse(result.stdout), {
      events: expected, exitCode: scenario === 'listen-failed' ? 1 : 0,
    });
  });
}
