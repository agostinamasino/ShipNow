import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import { assertHealth } from '../../test-support/health.js';

describe('Política por entorno con HTTP y persistencia simulada', () => {
  for (const nodeEnv of ['development', 'test', 'production']) it(`${nodeEnv}: health, Swagger, principales e internos`, () => {
    const source = `
      import { createRequire } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { PassThrough } from 'node:stream';
      import request from 'supertest';
      import mongoose from 'mongoose';
      import winston from 'winston';
      const require = createRequire(import.meta.url);
      const rotator = require(require.resolve('file-stream-rotator', { paths: [require.resolve('winston-daily-rotate-file')] }));
      const streams = []; rotator.getStream = () => { const stream = new PassThrough(); streams.push(stream); return stream; };
      const log = new EventEmitter(), events = [];
      for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) log[level] = message => events.push(message);
      winston.createLogger = () => log;
      let reads = 0, writes = 0, connections = 0;
      mongoose.connect = () => { connections++; throw new Error('Conexión prohibida'); };
      mongoose.Connection.prototype.openUri = mongoose.connect;
      mongoose.connection.transaction = () => { writes++; throw new Error('Transacción prohibida'); };
      for (const name of ['User', 'Order', 'Product', 'UploadedFile', 'Delivery']) {
        const Model = (await import('./src/models/' + name + '.js')).default;
        Model.insertMany = Model.create = () => { writes++; throw new Error('Escritura prohibida'); };
        Model.find = () => { reads++; const q = { sort() { return q; }, skip() { return q; }, limit() { return q; }, lean() { return q; }, then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); } }; return q; };
        Model.countDocuments = async () => { reads++; return 0; };
        Model.findById = () => ({ select: async () => ({ _id: '507f1f77bcf86cd799439011' }), then(resolve, reject) { return Promise.resolve({ _id: '507f1f77bcf86cd799439011' }).then(resolve, reject); } });
      }
      const signals = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
      const { default: app } = await import('./src/app.js');
      const importedSignals = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
      try {
        const before = reads;
        const health = await request(app).get('/health');
        const healthReads = reads - before;
        const docs = [];
        for (const path of ['/api/docs/', '/api/docs/swagger-ui.css', '/api/docs/swagger-ui-bundle.js', '/api/docs/swagger-ui-init.js']) docs.push((await request(app).get(path)).status);
        const principal = [];
        for (const path of ['/api/products', '/api/users', '/api/orders', '/api/users/507f1f77bcf86cd799439011/documents', '/api/orders/507f1f77bcf86cd799439011/receipts']) principal.push((await request(app).get(path)).status);
        const beforeInternal = reads;
        const internal = [];
        for (const entity of ['users', 'couriers', 'orders', 'deliveries']) {
          const result = await request(app).get('/api/mocks/' + entity + '?qty=0&NODE_ENV=development').set('x-node-env', 'development');
          internal.push({ status: result.status, body: result.body });
        }
        const seed = await request(app).post('/api/mocks/seed?qty=0').send({ NODE_ENV: 'development' });
        const demo = await request(app).get('/api/logger-test');
        console.log(JSON.stringify({ health: health.body, healthStatus: health.status, healthReads, docs, principal, internal, seed: { status: seed.status, body: seed.body }, demo: demo.status, internalReads: reads - beforeInternal, writes, connections, events, signals, importedSignals }));
      } finally { for (const stream of streams) stream.destroy(); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: nodeEnv === 'production' ? 'info' : 'debug', PORT: '3000', MONGODB_URI: 'mongodb://127.0.0.1/unused' },
      encoding: 'utf8', timeout: 10000,
    });
    expect(result.status, result.stderr).to.equal(0);
    const output = JSON.parse(result.stdout);
    assertHealth(output.health, nodeEnv);
    expect(output.healthStatus).to.equal(200);
    expect(output.healthReads).to.equal(0);
    expect(output.docs).to.deep.equal([200, 200, 200, 200]);
    expect(output.principal).to.deep.equal([200, 200, 200, 200, 200]);
    expect(output.signals).to.deep.equal(output.importedSignals);
    expect(output.writes).to.equal(0);
    expect(output.connections).to.equal(0);
    expect(output.internalReads).to.equal(0);
    for (const response of output.internal) {
      expect(response.status).to.equal(nodeEnv === 'production' ? 404 : 200);
      if (nodeEnv === 'production') expect(response.body.error.code).to.equal('ROUTE_NOT_FOUND');
    }
    expect(output.seed.status).to.equal(nodeEnv === 'production' ? 404 : 400);
    if (nodeEnv === 'production') {
      expect(output.seed.body.error.code).to.equal('ROUTE_NOT_FOUND');
      expect(output.events.some(event => event.startsWith('MOCK_'))).to.equal(false);
    }
    expect(output.demo).to.equal(nodeEnv === 'development' ? 200 : 404);
  });
});
