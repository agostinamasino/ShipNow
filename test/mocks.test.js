import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { before, after } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import mocksRouter from '../src/routes/mocks.routes.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY } from '../src/constants/index.js';

let server;
let baseUrl;
const endpoints = ['users', 'couriers', 'orders', 'deliveries'];

before(async () => {
  const app = express();
  app.use('/api/mocks', mocksRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/mocks`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

async function get(endpoint, query = '') {
  const response = await fetch(`${baseUrl}/${endpoint}${query}`);
  return { status: response.status, body: await response.json() };
}

async function assertPeople(people, role) {
  for (const person of people) {
    assert.equal(person.role, role);
    assert.match(person._id, /^[0-9a-f]{24}$/);
    assert.match(person.email, /@example\.com$/);
    await new User(person).validate();
  }
}

test('los cuatro GET generan dos elementos sin conexión ni operaciones MongoDB', async (t) => {
  assert.equal(mongoose.connection.readyState, 0);
  const operations = [t.mock.method(mongoose, 'connect', async () => {
    throw new Error('Los mocks no deben conectar a MongoDB');
  })];
  for (const Model of [User, Order, Delivery]) {
    for (const operation of ['find', 'insertOne', 'insertMany', 'updateOne', 'deleteOne']) {
      operations.push(t.mock.method(Model.collection, operation, () => {
        throw new Error('Los mocks no deben usar colecciones');
      }));
    }
  }

  for (const endpoint of endpoints) {
    const { status, body } = await get(endpoint, '?qty=2');
    assert.equal(status, 200, endpoint);
    assert.equal(body[endpoint].length, 2, endpoint);
  }
  assert.ok(operations.every(operation => operation.mock.callCount() === 0));
});

test('GET users y couriers usan sus roles y correos únicos', async () => {
  const { body: { users } } = await get('users', '?qty=3');
  const { body: { couriers } } = await get('couriers', '?qty=3');
  await assertPeople(users, USER_ROLES.USER);
  await assertPeople(couriers, USER_ROLES.COURIER);
  const emails = [...users, ...couriers].map(person => person.email);
  assert.equal(new Set(emails).size, emails.length);
});

test('GET orders incluye usuarios y pedidos pendientes con prioridades válidas', async () => {
  const { body: { orders, users } } = await get('orders', '?qty=3');
  assert.equal(users.length, 3);
  await assertPeople(users, USER_ROLES.USER);
  for (const order of orders) {
    assert.ok(users.some(user => user._id === order.userId));
    assert.equal(order.status, ORDER_STATUS.PENDING);
    assert.ok(Object.values(ORDER_PRIORITY).includes(order.priority));
    await new Order(order).validate();
  }
});

test('GET deliveries incluye referencias resolubles y estados compatibles', async () => {
  const { body: { deliveries, orders, users, couriers } } = await get('deliveries', '?qty=3');
  assert.deepEqual([deliveries.length, orders.length, users.length, couriers.length], [3, 3, 3, 3]);
  await assertPeople(users, USER_ROLES.USER);
  await assertPeople(couriers, USER_ROLES.COURIER);
  const emails = [...users, ...couriers].map(person => person.email);
  assert.equal(new Set(emails).size, emails.length);
  for (const delivery of deliveries) {
    const order = orders.find(order => order._id === delivery.orderId);
    assert.ok(order);
    assert.ok(users.some(user => user._id === order.userId));
    assert.ok(couriers.some(courier => courier._id === delivery.courierId));
    assert.equal(order.status, delivery.status === DELIVERY_STATUS.DELIVERED
      ? ORDER_STATUS.DELIVERED : ORDER_STATUS.IN_PROGRESS);
    await new Order(order).validate();
    await new Delivery(delivery).validate();
  }
  assert.deepEqual(new Set(deliveries.map(delivery => delivery.status)), new Set(Object.values(DELIVERY_STATUS)));
});

test('qty omitido devuelve diez elementos en cada GET', async () => {
  for (const endpoint of endpoints) {
    const { status, body } = await get(endpoint);
    assert.equal(status, 200, endpoint);
    assert.equal(body[endpoint].length, 10, endpoint);
  }
});

test('qty admite el límite de 100 y cero devuelve un lote vacío', async () => {
  const full = await get('users', '?qty=100');
  assert.equal(full.status, 200);
  assert.equal(full.body.users.length, 100);
  const empty = await get('deliveries', '?qty=0');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { deliveries: [], orders: [], users: [], couriers: [] });
});

test('qty inválido devuelve 400 en cada GET', async () => {
  for (const endpoint of endpoints) {
    for (const query of ['?qty=', '?qty=-1', '?qty=1.5', '?qty=101', '?qty=abc', '?qty=1e1', '?qty=1&qty=2']) {
      const { status, body } = await get(endpoint, query);
      assert.equal(status, 400, `${endpoint}${query}`);
      assert.match(body.error, /qty.*entero/);
    }
  }
});
