import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import Delivery from '../../src/models/Delivery.js';
import { stubs, expectError, secret } from '../support/helpers.js';
import { expectDomain } from '../support/domain.js';

describe('Seed por HTTP con transacciones e inserciones simuladas', () => {
  let doubles, calls, inserted, committed;
  const session = Object.freeze({ testSession: true });
  beforeEach(() => {
    doubles = stubs(); calls = []; inserted = new Map(); committed = false;
    doubles.replace(mongoose.connection, 'readyState', 1);
    doubles.replace(mongoose.connection, 'transaction', async callback => {
      calls.push('transaction');
      const result = await callback(session);
      committed = true;
      return result;
    });
    let nextId = 100;
    for (const Model of [User, Order, Delivery]) {
      doubles.replace(Model, 'insertMany', async (items, options) => {
        expect(options.session).to.equal(session);
        calls.push(Model.modelName);
        const docs = items.map(item => new Model({ ...item, _id: (++nextId).toString(16).padStart(24, '0') }));
        for (const doc of docs) await doc.validate();
        inserted.set(Model, docs);
        return docs;
      });
    }
  });
  afterEach(() => doubles.restore());

  async function expectBatch(response, counts) {
    expect(response.status).to.equal(201);
    expect(response.headers['content-type']).to.match(/json/);
    expect(response.body).to.have.all.keys('batchId', 'counts', 'ids');
    expect(response.body.batchId).to.match(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    expect(response.body.counts).to.deep.equal(counts);
    expect(response.body.ids).to.have.all.keys(...Object.keys(counts));
    expect(committed).to.equal(true);
    expect(calls).to.deep.equal(['transaction', 'User', 'Order', 'Delivery']);
    const plain = Model => (inserted.get(Model) ?? []).map(doc => JSON.parse(JSON.stringify(doc)));
    const people = plain(User);
    const batch = { users: people.slice(0, counts.users), couriers: people.slice(counts.users), orders: plain(Order), deliveries: plain(Delivery) };
    await expectDomain(batch);
    for (const key of Object.keys(counts)) {
      expect(response.body.ids[key]).to.deep.equal(batch[key].map(doc => doc._id));
      expect(response.body.ids[key]).to.have.lengthOf(counts[key]);
    }
    for (const person of people) expect(person.email).to.include(response.body.batchId);
  }
  it('201 con qty crea las cuatro entidades y responde IDs realmente devueltos por los dobles', async () => {
    await expectBatch(await request(app).post('/api/mocks/seed?qty=2'), { users: 2, couriers: 2, orders: 2, deliveries: 2 });
  });
  it('201 con cantidades explícitas conserva relaciones y sesión', async () => {
    const counts = { users: 2, couriers: 2, orders: 3, deliveries: 3 };
    await expectBatch(await request(app).post('/api/mocks/seed').send(counts), counts);
  });
  for (const qty of ['-1', '1.5', '26', '0', 'invalid', '1&qty=2']) {
    it(`rechaza qty=${qty} antes de persistir`, async () => {
      expectError(await request(app).post(`/api/mocks/seed?qty=${qty}`), 'MOCK_INVALID_QTY');
      expect(calls).to.deep.equal([]);
    });
  }
  it('rechaza combinar qty y body no vacío', async () => {
    expectError(await request(app).post('/api/mocks/seed?qty=1').send({ users: 1 }), 'MOCK_INVALID_SEED_REQUEST');
    expect(calls).to.deep.equal([]);
  });
  for (const body of [{}, { users: -1 }, { users: 1.5 }, { users: '1' }, { users: 101 }, { unknown: 1 }, []]) {
    it(`rechaza body ${JSON.stringify(body)} sin inserciones`, async () => {
      expectError(await request(app).post('/api/mocks/seed').send(body), 'MOCK_INVALID_SEED_REQUEST');
      expect(calls).to.deep.equal([]);
    });
  }
  for (const body of [{ orders: 1 }, { users: 1, orders: 1, deliveries: 1 }, { users: 1, couriers: 1, orders: 1, deliveries: 2 }]) {
    it(`rechaza dependencias imposibles ${JSON.stringify(body)}`, async () => {
      expectError(await request(app).post('/api/mocks/seed').send(body), 'MOCK_INVALID_SEED_RELATIONS');
      expect(calls).to.deep.equal([]);
    });
  }
  it('503 sin soporte transaccional, sin ejecutar inserciones', async () => {
    doubles.replace(mongoose.connection, 'transaction', async () => { throw Object.assign(new Error(secret), { code: 20 }); });
    expectError(await request(app).post('/api/mocks/seed?qty=1'), 'MOCK_SEED_UNAVAILABLE');
    expect(inserted.size).to.equal(0);
    expect(committed).to.equal(false);
  });
  it('503 con MongoDB desconectado no abre transacción', async () => {
    doubles.replace(mongoose.connection, 'readyState', 0);
    expectError(await request(app).post('/api/mocks/seed?qty=1'), 'MOCK_SEED_UNAVAILABLE');
    expect(calls).to.deep.equal([]);
  });
  it('500 ante fallo inesperado: simula rollback del lote pendiente', async () => {
    doubles.replace(mongoose.connection, 'transaction', async callback => {
      try { return await callback(session); }
      catch (error) { inserted.clear(); throw error; }
    });
    doubles.replace(Delivery, 'insertMany', async () => { throw new Error(secret); });
    expectError(await request(app).post('/api/mocks/seed?qty=1'), 'INTERNAL_ERROR');
    expect(calls).to.deep.equal(['User', 'Order']);
    expect(inserted.size).to.equal(0);
    expect(committed).to.equal(false);
  });
});
