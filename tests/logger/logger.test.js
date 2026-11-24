import { assertHealth } from '../../test-support/health.js';
import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERROR_CATALOG } from '../../src/errors/error.catalog.js';

describe('Logger por HTTP en procesos aislados', () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    it(`${nodeEnv}: disponibilidad por entorno sin archivos de logs`, () => {
      const source = `
        import { createRequire } from 'node:module';
        import { EventEmitter } from 'node:events';
        import { PassThrough } from 'node:stream';
        import request from 'supertest';
        import mongoose from 'mongoose';
        import winston from 'winston';
        const require = createRequire(import.meta.url);
        const rotator = require(require.resolve('file-stream-rotator', {
          paths: [require.resolve('winston-daily-rotate-file')],
        }));
        const streams = [];
        rotator.getStream = () => { const stream = new PassThrough(); streams.push(stream); return stream; };
        const events = [];
        const log = new EventEmitter();
        for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) {
          log[level] = message => events.push({ level, message });
        }
        winston.createLogger = () => log;
        mongoose.connect = () => { throw new Error('Conexión prohibida'); };
        mongoose.Connection.prototype.openUri = mongoose.connect;
        try {
          const { default: app } = await import('./src/app.js');
          const response = await request(app).get('/api/logger-test');
          const health = await request(app).get('/health');
          console.log(JSON.stringify({ status: response.status, body: response.body, health: health.body,
            demo: events.filter(event => event.message.startsWith('LOGGER_DEMO_')), connected: mongoose.connection.readyState }));
        } finally { for (const stream of streams) stream.destroy(); }
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, NODE_ENV: nodeEnv, PORT: '3000', MONGODB_URI: 'mongodb://127.0.0.1:27017/shipnow_test_unused' },
        encoding: 'utf8', timeout: 10000,
      });
      expect(result.error).to.equal(undefined);
      expect(result.status, result.stderr).to.equal(0);
      const output = JSON.parse(result.stdout);
      expect(output.connected).to.equal(0);
      assertHealth(output.health, nodeEnv);
      if (nodeEnv === 'development') {
        expect(output.status).to.equal(200);
        expect(output.body).to.deep.equal({ status: 'ok' });
        expect(output.demo).to.deep.equal(['debug', 'http', 'info', 'warning', 'error', 'fatal']
          .map(level => ({ level, message: `LOGGER_DEMO_${level.toUpperCase()}` })));
      } else {
        expect(output.status).to.equal(404);
        expect(output.body).to.deep.equal({ success: false, error: {
          code: 'ROUTE_NOT_FOUND', message: ERROR_CATALOG.ROUTE_NOT_FOUND.message,
        } });
        expect(output.demo).to.deep.equal([]);
      }
    });
  }
});
