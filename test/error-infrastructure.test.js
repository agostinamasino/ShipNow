import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { AppError } from '../src/errors/app-error.js';
import { ERROR_CATALOG } from '../src/errors/error.catalog.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

const marker = 'PRIVATE_INTERNAL_VALUE';

async function localUrl(t, server) {
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  if (!server.listening) await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function assertHttpError(response, code, details) {
  const { status, message } = ERROR_CATALOG[code];
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  const error = { code, message };
  if (details) error.details = details;
  assert.deepEqual(await response.json(), { success: false, error });
}

test('el catálogo congela el diccionario y cada definición pública', () => {
  const statuses = {
    INVALID_JSON: 400, PAYLOAD_TOO_LARGE: 413, ROUTE_NOT_FOUND: 404, PRODUCT_VALIDATION_FAILED: 400,
    PRODUCT_INVALID_STATUS: 400, USER_VALIDATION_FAILED: 400, USER_INVALID_ROLE: 400,
    USER_EMAIL_ALREADY_EXISTS: 409, MOCK_INVALID_QTY: 400, MOCK_INVALID_SEED_REQUEST: 400,
    MOCK_INVALID_SEED_RELATIONS: 400, MOCK_SEED_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
  };
  assert.ok(Object.isFrozen(ERROR_CATALOG));
  assert.deepEqual(Object.keys(ERROR_CATALOG).sort(), Object.keys(statuses).sort());
  for (const [code, status] of Object.entries(statuses)) {
    const entry = ERROR_CATALOG[code];
    assert.ok(Object.isFrozen(entry));
    assert.equal(entry.code, code);
    assert.equal(entry.status, status);
    assert.ok(entry.message.trim());
  }
});

test('AppError conserva la causa y solo admite detalles de campos conocidos', () => {
  const cause = new Error(marker);
  const err = new AppError('PRODUCT_VALIDATION_FAILED', {
    cause,
    details: { fields: ['price', marker, 'email', 'price'], value: marker },
  });
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'PRODUCT_VALIDATION_FAILED');
  assert.equal(err.status, 400);
  assert.equal(err.message, ERROR_CATALOG.PRODUCT_VALIDATION_FAILED.message);
  assert.equal(err.cause, cause);
  assert.deepEqual(err.details, { fields: ['price'] });
  assert.ok(Object.isFrozen(err.details.fields));
  assert.equal(new AppError('INTERNAL_ERROR', { details: { fields: ['price'] } }).details, undefined);
});

test('AppError rechaza códigos desconocidos y claves heredadas', () => {
  for (const code of ['UNKNOWN', 'constructor', '__proto__', undefined]) {
    assert.throws(() => new AppError(code), TypeError);
  }
});

test('si los encabezados ya salieron, el middleware delega el mismo error', () => {
  const err = new Error(marker);
  let forwarded;
  errorMiddleware(err, {}, { headersSent: true }, error => { forwarded = error; });
  assert.equal(forwarded, err);
});

test('solo el error específico del parser se clasifica como payload excedido', () => {
  for (const err of [
    Object.assign(new Error(marker), { status: 413 }),
    Object.assign(new Error(marker), { type: 'entity.too.large', status: 500 }),
  ]) {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; },
    };
    errorMiddleware(err, {}, res, () => assert.fail('No debe delegar'));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: ERROR_CATALOG.INTERNAL_ERROR.message },
    });
  }
});

test('Express 5 propaga excepciones síncronas y rechazos asíncronos al middleware', async (t) => {
  const app = express();
  app.get('/unexpected', () => {
    throw new Error(`mongodb://${marker}`, { cause: new Error(marker) });
  });
  app.get('/async', async () => {
    await Promise.resolve();
    throw new AppError('USER_VALIDATION_FAILED', {
      cause: new Error(marker),
      details: { fields: ['email', marker], credentials: marker },
    });
  });
  app.use(errorMiddleware);
  const origin = await localUrl(t, app.listen(0, '127.0.0.1'));
  await assertHttpError(await fetch(`${origin}/unexpected`), 'INTERNAL_ERROR');
  await assertHttpError(await fetch(`${origin}/async`), 'USER_VALIDATION_FAILED', { fields: ['email'] });
});

test('el servidor aplica el parser, 404 y middleware global, y conserva las rutas exitosas', async (t) => {
  t.mock.method(dotenv, 'config', () => {
    Object.assign(process.env, {
      PORT: '3000', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused', NODE_ENV: 'test',
    });
    return {};
  });
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const listen = express.application.listen;
  let server;
  t.mock.method(express.application, 'listen', function (_port, callback) {
    server = listen.call(this, 0, '127.0.0.1', callback);
    return server;
  });

  const product = { _id: '507f1f77bcf86cd799439011', name: 'Caja', price: 10, status: 'available' };
  const user = { _id: '507f1f77bcf86cd799439012', name: 'Ana', email: 'ana@example.com', role: 'user' };
  t.mock.method(Product, 'find', () => ({ lean: async () => [product] }));
  t.mock.method(Product, 'create', async () => product);
  t.mock.method(User, 'find', async () => [user]);
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  t.mock.method(User.prototype, 'save', async () => user);

  await import('../src/server.js');
  const origin = await localUrl(t, server);
  const request = (path, body) => fetch(`${origin}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });

  await assertHttpError(await request('/api/products', `{"name":"${marker}"`), 'INVALID_JSON');
  await t.test('el parser rechaza más de 100 KB en Products, Users y seed sin filtrar detalles', async () => {
    const payload = JSON.stringify({ name: marker, description: 'x'.repeat(101 * 1024) });
    assert.ok(Buffer.byteLength(payload) > 100 * 1024);
    const writes = [Product.create, User.prototype.save, User.collection.createIndex];
    const countsBefore = writes.map(write => write.mock.callCount());
    for (const path of ['/api/products', '/api/users', '/api/mocks/seed?qty=1']) {
      const response = await request(path, payload);
      assert.equal(response.status, 413);
      assert.match(response.headers.get('content-type'), /^application\/json\b/);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'El cuerpo de la solicitud supera el tamaño permitido.',
        },
      });
      for (const internal of [marker, 'stack', 'entity.too.large', 'limit', 'length', 'PayloadTooLargeError']) {
        assert.ok(!text.includes(internal));
      }
    }
    assert.deepEqual(writes.map(write => write.mock.callCount()), countsBefore);
  });
  await assertHttpError(await request('/api/no-existe'), 'ROUTE_NOT_FOUND');
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  for (const [path, item] of [['/api/products', product], ['/api/users', user]]) {
    const list = await request(path);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), [item]);
    const created = await request(path, JSON.stringify(item));
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), item);
  }
  for (const endpoint of ['users', 'couriers', 'orders', 'deliveries']) {
    const preview = await request(`/api/mocks/${endpoint}?qty=1`);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json())[endpoint].length, 1);
  }
});
