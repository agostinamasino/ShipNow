import { mockList, pageOf } from '../../test-support/pagination.js';
import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import Order from '../../src/models/Order.js';
import User from '../../src/models/User.js';
import { ORDER_STATUS, ORDER_PRIORITY, USER_ROLES } from '../../src/constants/index.js';
import { stubs, expectError, secret } from '../support/helpers.js';

describe('Orders por HTTP con persistencia simulada', () => {
  let doubles, fixture, input, calls;

  beforeEach(() => {
    doubles = stubs();
    input = { userId: '507f1f77bcf86cd799439012', destinationAddress: 'Calle de prueba 123' };
    fixture = {
      _id: '507f1f77bcf86cd799439031', ...input,
      status: ORDER_STATUS.PENDING, priority: ORDER_PRIORITY.NORMAL, __v: 0,
    };
    calls = { list: 0, order: [], users: [], selections: [], creates: [] };
    mockList(doubles.replace.bind(doubles), Order, async () => { calls.list++; return [new Order(fixture)]; });
    doubles.replace(Order, 'findById', async id => { calls.order.push(id); return new Order(fixture); });
    doubles.replace(User, 'findById', id => {
      calls.users.push(id);
      return { select: async fields => {
        calls.selections.push(fields);
        return { _id: input.userId, role: USER_ROLES.USER };
      } };
    });
    doubles.replace(Order, 'create', async data => {
      calls.creates.push(data);
      const order = new Order({ ...data, _id: fixture._id });
      await order.validate();
      order.__v = 0;
      return order;
    });
  });

  afterEach(() => {
    doubles.restore();
    expect(mongoose.connection.readyState).to.equal(0);
  });

  function expectOrder(order, expected = fixture) {
    expect(order).to.have.all.keys('_id', 'userId', 'destinationAddress', 'status', 'priority', '__v');
    expect(order).to.deep.equal(expected);
    expect(order._id).to.match(/^[a-f0-9]{24}$/);
    expect(order.userId).to.be.a('string').and.match(/^[a-f0-9]{24}$/);
  }

  describe('GET /api/orders', () => {
    it('200 con página de documentos y referencias como IDs, con orden ascendente por _id', async () => {
      const other = { ...fixture, _id: '507f1f77bcf86cd799439032', priority: ORDER_PRIORITY.HIGH };
      mockList(doubles.replace.bind(doubles), Order, async () => [new Order(other), new Order(fixture)]);
      const response = await request(app).get('/api/orders').expect(200).expect('Content-Type', /json/);
      expect(response.body.data).to.be.an('array').with.lengthOf(2);
      expect(response.body.data).to.have.deep.members([fixture, other]);
      for (const order of response.body.data) expectOrder(order, order._id === fixture._id ? fixture : other);
    });
    it('200 con array vacío', async () => {
      mockList(doubles.replace.bind(doubles), Order, async () => []);
      expect((await request(app).get('/api/orders').expect(200)).body).to.deep.equal(pageOf([]));
    });
    it('500 seguro ante fallo de listado', async () => {
      mockList(doubles.replace.bind(doubles), Order, async () => { throw new Error(secret); });
      expectError(await request(app).get('/api/orders'), 'INTERNAL_ERROR');
    });
  });

  describe('POST /api/orders', () => {
    it('201 con creación mínima, defaults y usuario USER consultado con proyección', async () => {
      const response = await request(app).post('/api/orders').send(input).expect(201).expect('Content-Type', /json/);
      expectOrder(response.body);
      expect(calls.users).to.deep.equal([input.userId]);
      expect(calls.selections).to.deep.equal(['_id role']);
      expect(calls.creates).to.deep.equal([{ ...input, status: ORDER_STATUS.PENDING, priority: ORDER_PRIORITY.NORMAL }]);
    });
    for (const [status, priority] of [
      [ORDER_STATUS.PENDING, ORDER_PRIORITY.LOW],
      [ORDER_STATUS.IN_PROGRESS, ORDER_PRIORITY.NORMAL],
      [ORDER_STATUS.DELIVERED, ORDER_PRIORITY.HIGH],
    ]) it(`201 acepta ${status} y ${priority} sin inventar transiciones`, async () => {
      const response = await request(app).post('/api/orders').send({ ...input, status, priority }).expect(201);
      expectOrder(response.body, { ...fixture, status, priority });
    });
    it('recorta dirección e ignora propiedades adicionales antes de persistir', async () => {
      const response = await request(app).post('/api/orders').send({
        ...input, destinationAddress: '  Calle de prueba 123  ',
        _id: '507f1f77bcf86cd799439099', __v: 99, items: ['ignored'], total: 999,
      }).expect(201);
      expectOrder(response.body);
      expect(calls.creates).to.deep.equal([{ ...input, status: ORDER_STATUS.PENDING, priority: ORDER_PRIORITY.NORMAL }]);
    });
    it('rechaza body ausente antes de consultar o insertar', async () => {
      expectError(await request(app).post('/api/orders'), 'ORDER_VALIDATION_FAILED');
      expect(calls.users).to.deep.equal([]);
      expect(calls.creates).to.deep.equal([]);
    });
    it('rechaza JSON null mediante INVALID_JSON del parser estricto existente', async () => {
      expectError(await request(app).post('/api/orders').type('json').send('null'), 'INVALID_JSON');
      expect(calls.users).to.deep.equal([]);
      expect(calls.creates).to.deep.equal([]);
    });
    it('rechaza array como body', async () => {
      expectError(await request(app).post('/api/orders').send([]), 'ORDER_VALIDATION_FAILED');
      expect(calls.users).to.deep.equal([]);
      expect(calls.creates).to.deep.equal([]);
    });

    const invalidFields = [
      ['userId ausente', data => { delete data.userId; }, ['userId']],
      ['userId mal formado', data => { data.userId = 'invalid'; }, ['userId']],
      ['userId de tipo incorrecto', data => { data.userId = 123; }, ['userId']],
      ['dirección ausente', data => { delete data.destinationAddress; }, ['destinationAddress']],
      ['dirección vacía', data => { data.destinationAddress = ''; }, ['destinationAddress']],
      ['dirección de espacios', data => { data.destinationAddress = '   '; }, ['destinationAddress']],
      ['dirección de tipo incorrecto', data => { data.destinationAddress = 123; }, ['destinationAddress']],
      ['dirección null', data => { data.destinationAddress = null; }, ['destinationAddress']],
      ['ambos campos ausentes', data => { delete data.userId; delete data.destinationAddress; }, ['userId', 'destinationAddress']],
    ];
    for (const [label, mutate, fields] of invalidFields) it(`400 para ${label}`, async () => {
      mutate(input);
      expectError(await request(app).post('/api/orders').send(input), 'ORDER_VALIDATION_FAILED', fields);
      expect(calls.users).to.deep.equal([]);
      expect(calls.creates).to.deep.equal([]);
    });
    for (const [field, code] of [['status', 'ORDER_INVALID_STATUS'], ['priority', 'ORDER_INVALID_PRIORITY']]) {
      for (const value of ['invalid', null, '']) it(`400 para ${field}=${JSON.stringify(value)}`, async () => {
        expectError(await request(app).post('/api/orders').send({ ...input, [field]: value }), code);
        expect(calls.users).to.deep.equal([]);
        expect(calls.creates).to.deep.equal([]);
      });
    }
    it('404 cuando el usuario no existe, sin insertar', async () => {
      doubles.replace(User, 'findById', () => ({ select: async () => null }));
      expectError(await request(app).post('/api/orders').send(input), 'ORDER_USER_NOT_FOUND');
      expect(calls.creates).to.deep.equal([]);
    });
    for (const role of [USER_ROLES.ADMIN, USER_ROLES.COURIER]) it(`400 para usuario con rol ${role}, sin insertar`, async () => {
      doubles.replace(User, 'findById', () => ({ select: async () => ({ _id: input.userId, role }) }));
      expectError(await request(app).post('/api/orders').send(input), 'ORDER_INVALID_USER_ROLE');
      expect(calls.creates).to.deep.equal([]);
    });
    it('500 seguro ante fallo al consultar usuario; no intenta insertar', async () => {
      doubles.replace(User, 'findById', () => ({ select: async () => { throw new Error(secret); } }));
      expectError(await request(app).post('/api/orders').send(input), 'INTERNAL_ERROR');
      expect(calls.creates).to.deep.equal([]);
    });
    it('500 seguro ante fallo inesperado de creación', async () => {
      doubles.replace(Order, 'create', async data => {
        calls.creates.push(data);
        throw new Error(secret, { cause: new Error('PRIVATE_TEST_VALUE') });
      });
      expectError(await request(app).post('/api/orders').send(input), 'INTERNAL_ERROR');
      expect(calls.creates).to.have.lengthOf(1);
    });
    it('traduce ValidationError real de Mongoose a 400 con campos permitidos', async () => {
      const invalid = new Order({ ...input, destinationAddress: '' });
      let validationError;
      try { await invalid.validate(); } catch (error) { validationError = error; }
      expect(validationError).to.be.instanceOf(mongoose.Error.ValidationError);
      validationError.addError('PRIVATE_TEST_VALUE', new mongoose.Error.ValidatorError({
        path: 'PRIVATE_TEST_VALUE', value: secret, message: secret,
      }));
      doubles.replace(Order, 'create', async () => { throw validationError; });
      expectError(await request(app).post('/api/orders').send(input), 'ORDER_VALIDATION_FAILED', ['destinationAddress']);
    });
  });

  describe('GET /api/orders/:id', () => {
    it('200 para pedido existente, con documento y referencia correctos', async () => {
      const response = await request(app).get(`/api/orders/${fixture._id}`).expect(200).expect('Content-Type', /json/);
      expectOrder(response.body);
      expect(calls.order).to.deep.equal([fixture._id]);
    });
    it('404 ORDER_NOT_FOUND para ID válido inexistente', async () => {
      doubles.replace(Order, 'findById', async () => null);
      expectError(await request(app).get(`/api/orders/${fixture._id}`), 'ORDER_NOT_FOUND');
    });
    for (const id of ['invalid', '507f1f77bcf86cd79943903', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      it(`400 para ID ${id}, sin consultar persistencia`, async () => {
        expectError(await request(app).get(`/api/orders/${id}`), 'ORDER_INVALID_ID');
        expect(calls.order).to.deep.equal([]);
      });
    }
    it('500 seguro ante fallo al buscar pedido', async () => {
      doubles.replace(Order, 'findById', async () => { throw new Error(secret); });
      expectError(await request(app).get(`/api/orders/${fixture._id}`), 'INTERNAL_ERROR');
    });
  });
});
