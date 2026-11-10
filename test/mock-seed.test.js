import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { seedMocks } from '../src/controllers/mock.controller.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { ERROR_CATALOG } from '../src/errors/error.catalog.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../src/constants/index.js';

async function seed({ qty, body } = {}) {
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const req = { query: { qty }, body };
  try {
    await seedMocks(req, response);
  } catch (error) {
    errorMiddleware(error, req, response, err => { throw err; });
  }
  return response;
}

function assertError(response, code) {
  const { status, message } = ERROR_CATALOG[code];
  assert.equal(response.statusCode, status);
  assert.deepEqual(response.body, { success: false, error: { code, message } });
}

function mockReadyState(t, readyState) {
  Object.defineProperty(mongoose.connection, 'readyState', { value: readyState, configurable: true });
  t.after(() => { delete mongoose.connection.readyState; });
}

test('rechaza cantidades inválidas y dependencias incompletas antes de abrir una transacción', async (t) => {
  mockReadyState(t, 1);
  const transaction = t.mock.method(mongoose.connection, 'transaction');
  const inserts = [User, Order, Delivery].map(Model => t.mock.method(Model, 'insertMany'));
  for (const qty of ['0', '26', '-1', '1.5', ['2', '2']]) {
    assertError(await seed({ qty }), 'MOCK_INVALID_QTY');
  }
  for (const input of [
    {},
    { qty: '2', body: { users: 2 } }, { body: [] }, { body: null }, { body: { extra: 1 } },
    { body: { users: '2' } }, { body: { users: null } }, { body: { users: -1 } },
    { body: { users: 1.5 } }, { body: { users: 100, couriers: 1 } },
  ]) {
    assertError(await seed(input), 'MOCK_INVALID_SEED_REQUEST');
  }
  for (const input of [
    { body: { orders: 1 } }, { body: { users: 1, orders: 1, deliveries: 1 } },
    { body: { users: 1, couriers: 1, orders: 1, deliveries: 2 } },
  ]) {
    assertError(await seed(input), 'MOCK_INVALID_SEED_RELATIONS');
  }
  assert.equal(transaction.mock.callCount(), 0);
  assert.ok(inserts.every(insert => insert.mock.callCount() === 0));
});

test('inserta en orden con una sesión y usa los IDs devueltos por cada inserción', async (t) => {
  mockReadyState(t, 1);
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', callback => callback(session));
  const events = [];
  const inserted = new Map();
  for (const Model of [User, Order, Delivery]) {
    t.mock.method(Model, 'insertMany', async (items, options) => {
      assert.equal(options.session, session);
      events.push(Model.modelName);
      const docs = await Promise.all(items.map(async item => {
        const doc = new Model({ ...item, _id: new mongoose.Types.ObjectId() });
        await doc.validate();
        return doc;
      }));
      inserted.set(Model, docs);
      return docs;
    });
  }

  const counts = { users: 2, couriers: 2, orders: 3, deliveries: 3 };
  const response = await seed({ body: counts });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body.counts, counts);
  assert.deepEqual(events, ['User', 'Order', 'Delivery']);
  const people = inserted.get(User);
  const orders = inserted.get(Order);
  const deliveries = inserted.get(Delivery);
  assert.equal(new Set(people.map(doc => doc.email)).size, people.length);
  assert.ok(people.every(doc => doc.email.includes(response.body.batchId)));
  assert.deepEqual(response.body.ids.orders, orders.map(doc => String(doc._id)));
  assert.deepEqual(response.body.ids.deliveries, deliveries.map(doc => String(doc._id)));
  assert.deepEqual(response.body.ids.users, people.slice(0, 2).map(doc => String(doc._id)));
  assert.deepEqual(response.body.ids.couriers, people.slice(2).map(doc => String(doc._id)));
  for (const delivery of deliveries) {
    const order = orders.find(doc => doc._id.equals(delivery.orderId));
    assert.ok(order);
    assert.equal(people.find(doc => doc._id.equals(order.userId))?.role, USER_ROLES.USER);
    assert.equal(people.find(doc => doc._id.equals(delivery.courierId))?.role, USER_ROLES.COURIER);
    assert.equal(order.status, delivery.status === DELIVERY_STATUS.DELIVERED
      ? ORDER_STATUS.DELIVERED : ORDER_STATUS.IN_PROGRESS);
  }
  assert.equal(orders[0].userId.toString(), orders[2].userId.toString());
});

test('sin conexión devuelve 503 y evita abrir la transacción', async (t) => {
  mockReadyState(t, 0);
  const transaction = t.mock.method(mongoose.connection, 'transaction');
  assertError(await seed({ qty: '1' }), 'MOCK_SEED_UNAVAILABLE');
  assert.equal(transaction.mock.callCount(), 0);
});

test('un rechazo transaccional devuelve 503 sin reintentar fuera de la sesión', async (t) => {
  mockReadyState(t, 1);
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', callback => callback(session));
  const insert = t.mock.method(User, 'insertMany', async (items, options) => {
    assert.equal(items.length, 20);
    assert.equal(options.session, session);
    throw Object.assign(new Error('detalle interno'), { code: 20 });
  });
  const response = await seed({ qty: '10' });
  assertError(response, 'MOCK_SEED_UNAVAILABLE');
  assert.equal(insert.mock.callCount(), 1);
});

test('qty conserva la cantidad por entidad y el body admite campos omitidos', async (t) => {
  mockReadyState(t, 1);
  t.mock.method(mongoose.connection, 'transaction', callback => callback({}));
  for (const Model of [User, Order, Delivery]) {
    t.mock.method(Model, 'insertMany', async items => items);
  }
  for (const qty of [10, 25]) {
    const response = await seed({ qty: String(qty) });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body.counts, { users: qty, couriers: qty, orders: qty, deliveries: qty });
    assert.ok(Object.values(response.body.ids).every(ids => ids.length === qty));
  }
  const partial = await seed({ body: { couriers: 1 } });
  assert.equal(partial.statusCode, 201);
  assert.deepEqual(partial.body.counts, { users: 0, couriers: 1, orders: 0, deliveries: 0 });
});

test('un fallo de inserción rechaza la transacción y devuelve 500 sin reintentar fuera de ella', async (t) => {
  mockReadyState(t, 1);
  const session = {};
  const committed = ['documento previo'];
  const pending = [];
  const failure = new Error('detalle privado de persistencia');
  const abort = t.mock.fn(() => { pending.length = 0; });
  t.mock.method(mongoose.connection, 'transaction', async callback => {
    try {
      const result = await callback(session);
      committed.push(...pending);
      return result;
    } catch (error) {
      assert.equal(error, failure);
      assert.equal(pending.length, 4);
      abort();
      throw error;
    }
  });
  const inserts = [User, Order, Delivery].map(Model => t.mock.method(Model, 'insertMany', async (items, options) => {
    assert.equal(options.session, session);
    pending.push(...items);
    if (Model === Delivery) throw failure;
    return items;
  }));

  assertError(await seed({ qty: '1' }), 'INTERNAL_ERROR');
  assert.equal(abort.mock.callCount(), 1);
  assert.deepEqual(committed, ['documento previo']);
  assert.ok(inserts.every(insert => insert.mock.callCount() === 1));
});
