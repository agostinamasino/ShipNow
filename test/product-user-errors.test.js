import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import * as productService from '../src/services/product.service.js';
import productsRouter from '../src/routes/products.routes.js';
import usersRouter from '../src/routes/users.routes.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { ERROR_CATALOG } from '../src/errors/error.catalog.js';

const marker = 'PRIVATE_INPUT_DO_NOT_EXPOSE';
const product = { name: 'Caja', price: 1 };
const user = { name: 'Ana', email: 'ana@example.com' };
let server;
let origin;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use('/api/users', usersRouter);
  app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

function request(resource, body) {
  return fetch(`${origin}/api/${resource}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function assertError(response, code, fields) {
  const { status, message } = ERROR_CATALOG[code];
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  const expected = { code, message };
  if (fields) expected.details = { fields };
  assert.deepEqual(await response.json(), { success: false, error: expected });
}

for (const [field, data] of [
  ['price', { ...product, price: marker }],
  ['stock', { ...product, stock: { private: marker } }],
  ['name', { ...product, name: { private: marker } }],
  ['name', { price: 1 }],
]) {
  test(`Products devuelve 400 seguro ante validación real de Mongoose en ${field}`, async (t) => {
    t.mock.method(Product, 'create', async data => {
      const doc = new Product(data);
      await doc.validate();
      return doc;
    });
    await assertError(await request('products', data), 'PRODUCT_VALIDATION_FAILED', [field]);
  });
}

test('Products omite detalles de validación que no identifican campos permitidos', async (t) => {
  const error = Object.assign(new Error(marker), {
    name: 'ValidationError',
    errors: { [marker]: { message: marker } },
  });
  t.mock.method(Product, 'create', async () => { throw error; });
  await assertError(await request('products', product), 'PRODUCT_VALIDATION_FAILED');
});

test('Products devuelve 400 para un estado inválido enviado en POST', async () => {
  await assertError(await request('products', { ...product, status: marker }), 'PRODUCT_INVALID_STATUS');
});

test('Products devuelve 500 para un estado histórico inválido al listar', async (t) => {
  t.mock.method(Product, 'find', () => ({ lean: async () => [{ ...product, status: marker }] }));
  await assertError(await request('products'), 'INTERNAL_ERROR');
});

test('Products propaga errores de escritura intactos y responde 500 seguro', async (t) => {
  const error = new Error(`MongoServerError: mongodb://${marker}`);
  t.mock.method(Product, 'create', async () => { throw error; });
  await assert.rejects(productService.createProduct(product), received => received === error);
  await assertError(await request('products', product), 'INTERNAL_ERROR');
});

test('Products devuelve 500 seguro ante un fallo de lectura', async (t) => {
  t.mock.method(Product, 'find', () => { throw new Error(marker); });
  await assertError(await request('products'), 'INTERNAL_ERROR');
});

test('Users devuelve 400 seguro ante un error de validación de Mongoose', async () => {
  await assertError(await request('users', { ...user, email: { private: marker } }),
    'USER_VALIDATION_FAILED', ['email']);
});

test('Users devuelve 400 ante un rol inválido', async () => {
  await assertError(await request('users', { ...user, role: marker }), 'USER_INVALID_ROLE');
});

test('Users devuelve 409 si el correo normalizado ya existe antes de guardar', async (t) => {
  const find = t.mock.method(User, 'findOne', async () => user);
  const save = t.mock.method(User.prototype, 'save', async () => user);
  await assertError(await request('users', { ...user, email: ' ANA@example.com ' }),
    'USER_EMAIL_ALREADY_EXISTS');
  assert.deepEqual(find.mock.calls[0].arguments, [{ email: user.email }]);
  assert.equal(save.mock.callCount(), 0);
});

test('Users devuelve 500 si falla la creación del índice, incluso con código 11000', async (t) => {
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => {
    throw Object.assign(new Error(marker), { code: 11000, keyPattern: { email: 1 } });
  });
  await assertError(await request('users', user), 'INTERNAL_ERROR');
});

test('Users devuelve 409 si el índice de email rechaza la escritura y 500 para otro índice', async (t) => {
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  let keyPattern = { email: 1 };
  const save = t.mock.method(User.prototype, 'save', async () => {
    throw Object.assign(new Error(marker), { code: 11000, keyPattern, keyValue: { email: user.email } });
  });
  await assertError(await request('users', user), 'USER_EMAIL_ALREADY_EXISTS');
  keyPattern = { _id: 1 };
  await assertError(await request('users', user), 'INTERNAL_ERROR');
  assert.equal(save.mock.callCount(), 2);
});
