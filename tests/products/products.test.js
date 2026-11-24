import { mockList, pageOf } from '../../test-support/pagination.js';
import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';
import Product from '../../src/models/Product.js';
import { PRODUCT_STATUS } from '../../src/constants/index.js';
import { stubs, expectError, id, secret } from '../support/helpers.js';

describe('Products por HTTP con persistencia simulada', () => {
  let doubles;
  beforeEach(() => {
    doubles = stubs();
    doubles.replace(Product, 'create', async data => {
      const product = new Product(data);
      await product.validate();
      product.__v = 0;
      return product;
    });
  });
  afterEach(() => doubles.restore());
  it('GET devuelve 200 y el producto controlado con tipos correctos', async () => {
    const products = [{ _id: id, name: 'Caja', description: '', price: 1500, stock: 20, status: PRODUCT_STATUS.AVAILABLE, __v: 0 }];
    mockList(doubles.replace.bind(doubles), Product, () => ({ lean: async () => products }));
    const response = await request(app).get('/api/products').expect(200);
    expect(response.body).to.deep.equal(pageOf(products));
  });
  it('GET falla con 500 seguro ante error de persistencia', async () => {
    mockList(doubles.replace.bind(doubles), Product, () => ({ lean: async () => { throw new Error(secret); } }));
    expectError(await request(app).get('/api/products'), 'INTERNAL_ERROR');
  });
  it('POST crea con 201, campos reales y defaults', async () => {
    const response = await request(app).post('/api/products').send({ name: ' Caja ', price: 1500 }).expect(201);
    expect(response.body).to.have.all.keys('_id', 'name', 'description', 'price', 'stock', 'status', '__v');
    expect(response.body).to.include({ name: 'Caja', price: 1500, description: '', stock: 0, status: PRODUCT_STATUS.AVAILABLE, __v: 0 });
    expect(response.body._id).to.match(/^[a-f0-9]{24}$/);
  });
  it('POST acepta estado permitido y campos explícitos', async () => {
    const data = { name: 'Caja', description: 'Para envíos', price: 1500, stock: 20, status: PRODUCT_STATUS.OUT_OF_STOCK };
    const response = await request(app).post('/api/products').send(data).expect(201);
    expect(response.body).to.include(data);
  });
  for (const [label, data, field] of [
    ['nombre ausente', { price: 1 }, 'name'],
    ['precio ausente', { name: 'Caja' }, 'price'],
    ['precio inválido', { name: 'Caja', price: 'invalid' }, 'price'],
    ['precio negativo', { name: 'Caja', price: -1 }, 'price'],
    ['stock decimal', { name: 'Caja', price: 1, stock: 1.5 }, 'stock'],
    ['stock negativo', { name: 'Caja', price: 1, stock: -1 }, 'stock'],
  ]) it(`POST rechaza ${label}`, async () => {
    expectError(await request(app).post('/api/products').send(data), 'PRODUCT_VALIDATION_FAILED', [field]);
  });
  it('POST rechaza estado inválido', async () => {
    expectError(await request(app).post('/api/products').send({ name: 'Caja', price: 1, status: 'invalid' }), 'PRODUCT_INVALID_STATUS');
  });
});
