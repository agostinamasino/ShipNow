import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { seedMocks } from '../src/controllers/mock.controller.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../src/constants/index.js';

async function seed({ qty, body } = {}) {
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await seedMocks({ query: { qty }, body }, response);
  return response;
}

function mockReadyState(t, readyState) {
  Object.defineProperty(mongoose.connection, 'readyState', { value: readyState, configurable: true });
  t.after(() => { delete mongoose.connection.readyState; });
}

test('rechaza cantidades inválidas y dependencias incompletas antes de abrir una transacción', async (t) => {
  const transaction = t.mock.method(mongoose.connection, 'transaction');
  for (const input of [
    {}, { qty: '0' }, { qty: '26' }, { qty: '-1' }, { qty: '1.5' }, { qty: ['2', '2'] },
    { qty: '2', body: { users: 2 } }, { body: [] }, { body: null }, { body: { extra: 1 } },
    { body: { users: '2' } }, { body: { users: null } }, { body: { users: -1 } },
    { body: { users: 1.5 } }, { body: { users: 100, couriers: 1 } },
    { body: { orders: 1 } }, { body: { users: 1, orders: 1, deliveries: 1 } },
    { body: { users: 1, couriers: 1, orders: 1, deliveries: 2 } },
  ]) {
    const response = await seed(input);
    assert.equal(response.statusCode, 400, JSON.stringify(input));
    assert.ok(response.body.error);
  }
  assert.equal(transaction.mock.callCount(), 0);
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
  assert.equal((await seed({ qty: '1' })).statusCode, 503);
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
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body.error, /detalle interno/);
  assert.equal(insert.mock.callCount(), 1);
});
