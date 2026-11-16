import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import Delivery from '../../src/models/Delivery.js';
import { stubs, expectError } from '../support/helpers.js';
import { expectDomain } from '../support/domain.js';

describe('GET de mocks sin MongoDB', () => {
  let doubles, writes;
  beforeEach(() => {
    doubles = stubs();
    writes = 0;
    const forbidden = () => { writes++; throw new Error('Escritura no permitida'); };
    doubles.replace(mongoose.connection, 'transaction', forbidden);
    for (const Model of [User, Order, Delivery]) {
      for (const method of ['create', 'insertMany']) doubles.replace(Model, method, forbidden);
      doubles.replace(Model.prototype, 'save', forbidden);
    }
  });
  afterEach(() => {
    doubles.restore();
    expect(writes).to.equal(0);
    expect(mongoose.connection.readyState).to.equal(0);
  });
  for (const [entity, keys] of [
    ['users', ['users']], ['couriers', ['couriers']],
    ['orders', ['orders', 'users']], ['deliveries', ['deliveries', 'orders', 'users', 'couriers']],
  ]) {
    describe(entity, () => {
      for (const [query, count] of [['', 10], ['?qty=3', 3], ['?qty=0', 0], ['?qty=100', 100]]) {
        it(`200: ${query || 'cantidad predeterminada'}, estructura y relaciones coherentes`, async () => {
          const response = await request(app).get(`/api/mocks/${entity}${query}`).expect(200).expect('Content-Type', /json/);
          expect(response.body).to.have.all.keys(...keys);
          for (const key of keys) expect(response.body[key]).to.be.an('array').with.lengthOf(count);
          await expectDomain(response.body);
        });
      }
      for (const query of ['qty=invalid', 'qty=-1', 'qty=1.5', 'qty=101', 'qty=1&qty=2', 'qty=']) {
        it(`400 para ${query}`, async () => {
          expectError(await request(app).get(`/api/mocks/${entity}?${query}`), 'MOCK_INVALID_QTY');
        });
      }
    });
  }
});
