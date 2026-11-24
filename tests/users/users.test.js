import { mockList, pageOf } from '../../test-support/pagination.js';
import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import { USER_ROLES } from '../../src/constants/index.js';
import { stubs, expectError, id, secret } from '../support/helpers.js';

describe('Users por HTTP con persistencia simulada', () => {
  let doubles;
  beforeEach(() => {
    doubles = stubs();
    doubles.replace(User, 'findOne', async () => null);
    // La promesa de índice puede estar cacheada: nunca se depende de su número de llamadas.
    doubles.replace(User.collection, 'createIndex', async () => 'email_1');
    doubles.replace(User.prototype, 'save', async function () { this.__v = 0; return this; });
  });
  afterEach(() => doubles.restore());

  it('GET 200 devuelve el array controlado con campos reales', async () => {
    const users = [{ _id: id, name: 'Usuario de prueba', email: 'user@example.com', role: USER_ROLES.USER, __v: 0 }];
    mockList(doubles.replace.bind(doubles), User, async () => users);
    const response = await request(app).get('/api/users').expect(200);
    expect(response.body).to.deep.equal(pageOf(users));
  });
  it('GET ante fallo de lectura devuelve 500 seguro', async () => {
    mockList(doubles.replace.bind(doubles), User, async () => { throw new Error(secret); });
    expectError(await request(app).get('/api/users'), 'INTERNAL_ERROR');
  });
  it('POST 201 normaliza email y conserva defaults y campos', async () => {
    let queried;
    doubles.replace(User, 'findOne', async filter => { queried = filter; return null; });
    const response = await request(app).post('/api/users').send({ name: ' Usuario ', email: ' USER@EXAMPLE.COM ' }).expect(201);
    expect(queried).to.deep.equal({ email: 'user@example.com' });
    expect(response.body).to.have.all.keys('_id', 'name', 'email', 'role', '__v');
    expect(response.body).to.include({ name: 'Usuario', email: 'user@example.com', role: USER_ROLES.USER, __v: 0 });
    expect(response.body._id).to.match(/^[a-f0-9]{24}$/);
  });
  for (const [label, data, field] of [
    ['nombre ausente', { email: 'user@example.com' }, 'name'],
    ['email ausente', { name: 'Usuario' }, 'email'],
    ['email inválido', { name: 'Usuario', email: 'invalid' }, 'email'],
  ]) {
    it(`POST rechaza ${label} con 400`, async () => {
      let saves = 0;
      doubles.replace(User.prototype, 'save', async () => { saves++; });
      expectError(await request(app).post('/api/users').send(data), 'USER_VALIDATION_FAILED', [field]);
      expect(saves).to.equal(0);
    });
  }
  it('POST rechaza rol inválido', async () => {
    expectError(await request(app).post('/api/users').send({ name: 'Usuario', email: 'user@example.com', role: 'invalid' }), 'USER_INVALID_ROLE');
  });
  it('POST detecta email duplicado antes de guardar', async () => {
    doubles.replace(User, 'findOne', async () => ({ _id: id }));
    expectError(await request(app).post('/api/users').send({ name: 'Usuario', email: 'user@example.com' }), 'USER_EMAIL_ALREADY_EXISTS');
  });
  it('POST detecta colisión del índice único al guardar', async () => {
    doubles.replace(User.prototype, 'save', async () => { throw Object.assign(new Error(secret), { code: 11000, keyPattern: { email: 1 } }); });
    expectError(await request(app).post('/api/users').send({ name: 'Usuario', email: 'user@example.com' }), 'USER_EMAIL_ALREADY_EXISTS');
  });
  it('POST propaga errores inesperados de guardado sin filtrarlos', async () => {
    doubles.replace(User.prototype, 'save', async () => { throw new Error(secret); });
    expectError(await request(app).post('/api/users').send({ name: 'Usuario', email: 'user@example.com' }), 'INTERNAL_ERROR');
  });
});
