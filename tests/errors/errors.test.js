import { mockList } from '../../test-support/pagination.js';
import request from 'supertest';
import app from '../../src/app.js';
import Product from '../../src/models/Product.js';
import { stubs, expectError, secret } from '../support/helpers.js';

describe('Errores globales por HTTP', () => {
  let doubles;
  beforeEach(() => { doubles = stubs(); });
  afterEach(() => doubles.restore());
  it('404 ROUTE_NOT_FOUND', async () => {
    expectError(await request(app).get('/not-a-route?private=PRIVATE_TEST_VALUE'), 'ROUTE_NOT_FOUND');
  });
  it('400 INVALID_JSON', async () => {
    expectError(await request(app).post('/api/products').type('json').send('{"private":"PRIVATE_TEST_VALUE",'), 'INVALID_JSON');
  });
  it('413 PAYLOAD_TOO_LARGE para body mayor a 100 KB', async () => {
    expectError(await request(app).post('/api/products').send({ value: 'PRIVATE_TEST_VALUE'.repeat(7000) }), 'PAYLOAD_TOO_LARGE');
  });
  it('500 INTERNAL_ERROR oculta mensaje, stack y causa inesperada', async () => {
    mockList(doubles.replace.bind(doubles), Product, () => ({ lean: async () => { throw new Error(secret, { cause: new Error('PRIVATE_TEST_VALUE') }); } }));
    expectError(await request(app).get('/api/products'), 'INTERNAL_ERROR');
  });
});
