import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import mongoose from 'mongoose';
import logger from '../src/config/logger.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import * as products from '../src/services/product.service.js';
import * as users from '../src/services/user.service.js';
import * as mocks from '../src/services/mock.service.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { PRODUCT_STATUS } from '../src/constants/index.js';

const realLogDirectory = fileURLToPath(new URL('../logs/', import.meta.url));
const logSnapshot = () => existsSync(realLogDirectory) ? readdirSync(realLogDirectory) : null;
const initialLogs = logSnapshot();
const sensitive = 'PRIVATE_PERSONAL_VALUE';

after(() => {
  logger.close();
  assert.deepEqual(logSnapshot(), initialLogs);
});

function capture(t) {
  const events = [];
  for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) {
    t.mock.method(logger, level, (...args) => { events.push({ level, args }); });
  }
  t.after(() => assert.ok(!JSON.stringify(events).includes(sensitive)));
  return events;
}

function ready(t) {
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  t.after(() => { delete mongoose.connection.readyState; });
}

function insertInMemory(t) {
  for (const Model of [User, Order, Delivery]) {
    t.mock.method(Model, 'insertMany', async items => items);
  }
}

test('Products registra creación y listado una vez, conservando documentos y sin datos personales', async (t) => {
  const events = capture(t);
  const doc = { name: sensitive, price: 1, status: PRODUCT_STATUS.AVAILABLE };
  t.mock.method(Product, 'create', async () => doc);
  t.mock.method(Product, 'find', () => ({ lean: async () => [doc, doc] }));
  assert.equal(await products.createProduct(doc), doc);
  assert.deepEqual(await products.getProducts(), [doc, doc]);
  assert.deepEqual(events, [
    { level: 'info', args: ['PRODUCT_CREATED'] },
    { level: 'debug', args: ['PRODUCTS_LISTED count=2'] },
  ]);
});

test('Users registra creación y listado una vez sin incluir el correo ni el nombre', async (t) => {
  const events = capture(t);
  const doc = { name: sensitive, email: sensitive + '@example.com' };
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  t.mock.method(User.prototype, 'save', async () => doc);
  t.mock.method(User, 'find', async () => [doc]);
  assert.equal(await users.createUser(doc), doc);
  assert.deepEqual(await users.getUsers(), [doc]);
  assert.deepEqual(events, [
    { level: 'info', args: ['USER_CREATED'] },
    { level: 'debug', args: ['USERS_LISTED count=1'] },
  ]);
});

test('Products y Users no anuncian éxito ni registran errores en sus services si la persistencia falla', async (t) => {
  const events = capture(t);
  const failure = new Error(sensitive);
  t.mock.method(Product, 'create', async () => { throw failure; });
  t.mock.method(Product, 'find', () => ({ lean: async () => { throw failure; } }));
  t.mock.method(User, 'find', async () => { throw failure; });
  t.mock.method(User.prototype, 'save', async () => { throw failure; });
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  for (const operation of [
    () => products.createProduct({ name: 'Caja', price: 1 }),
    () => products.getProducts(),
    () => users.createUser({ name: 'Ana', email: 'ana@example.com' }),
    () => users.getUsers(),
  ]) {
    await assert.rejects(operation(), error => error === failure);
  }
  assert.deepEqual(events, []);
});

test('un estado histórico inválido no anuncia un listado exitoso', async (t) => {
  const events = capture(t);
  t.mock.method(Product, 'find', () => ({ lean: async () => [{ status: sensitive }] }));
  await assert.rejects(products.getProducts());
  assert.deepEqual(events, []);
});

test('cada vista previa registra solo la entidad solicitada y su cantidad', (t) => {
  const events = capture(t);
  for (const [entity, generate] of [
    ['users', mocks.getMockUsers], ['couriers', mocks.getMockCouriers],
    ['orders', mocks.getMockOrders], ['deliveries', mocks.getMockDeliveries],
  ]) {
    for (const qty of [0, 2, 10]) {
      events.length = 0;
      const result = generate(qty === 10 ? undefined : String(qty));
      assert.equal(result[entity].length, qty);
      assert.deepEqual(events, [{ level: 'debug', args: [`MOCK_PREVIEW entity=${entity} qty=${qty}`] }]);
    }
    events.length = 0;
    assert.throws(() => generate(sensitive));
    assert.deepEqual(events, []);
  }
});

test('seed anuncia éxito después del commit aunque se reintente el callback', async (t) => {
  const events = capture(t);
  ready(t);
  insertInMemory(t);
  let releaseCommit;
  let callbackCompleted;
  const beforeCommit = new Promise(resolve => { callbackCompleted = resolve; });
  const commit = new Promise(resolve => { releaseCommit = resolve; });
  const transaction = t.mock.method(mongoose.connection, 'transaction', async callback => {
    await callback({});
    const result = await callback({});
    callbackCompleted();
    await commit;
    return result;
  });
  const pending = mocks.seedMocks(undefined, { users: 1, couriers: 1, orders: 2, deliveries: 1 });
  await beforeCommit;
  assert.deepEqual(events, [{
    level: 'info', args: ['MOCK_SEED_STARTED users=1 couriers=1 orders=2 deliveries=1'],
  }]);
  releaseCommit();
  const result = await pending;
  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(result.ids.orders.length, 2);
  assert.deepEqual(events, [
    { level: 'info', args: ['MOCK_SEED_STARTED users=1 couriers=1 orders=2 deliveries=1'] },
    { level: 'info', args: ['MOCK_SEED_COMPLETED users=1 couriers=1 orders=2 deliveries=1'] },
  ]);
});

test('fallo durante el commit omite el éxito y el middleware registra un único error', async (t) => {
  const events = capture(t);
  ready(t);
  insertInMemory(t);
  const failure = new Error(sensitive);
  t.mock.method(mongoose.connection, 'transaction', async callback => {
    await callback({});
    throw failure;
  });
  await assert.rejects(mocks.seedMocks('1'), error => error === failure);
  assert.deepEqual(events, [{
    level: 'info', args: ['MOCK_SEED_STARTED users=1 couriers=1 orders=1 deliveries=1'],
  }]);
  const res = {
    status(code) { assert.equal(code, 500); return this; },
    json(body) { assert.equal(body.error.code, 'INTERNAL_ERROR'); },
  };
  errorMiddleware(failure, {}, res, () => assert.fail('No debe delegar'));
  assert.deepEqual(events.at(-1), { level: 'error', args: ['HTTP_ERROR code=INTERNAL_ERROR status=500'] });
  assert.equal(events.filter(event => event.level === 'error').length, 1);
});

test('validaciones rechazadas del seed no anuncian inicio ni éxito', async (t) => {
  const events = capture(t);
  await assert.rejects(mocks.seedMocks('-1'));
  await assert.rejects(mocks.seedMocks(undefined, { orders: 1 }));
  assert.deepEqual(events, []);
});
