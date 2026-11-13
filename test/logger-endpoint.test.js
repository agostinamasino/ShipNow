import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

for (const nodeEnv of ['development', 'production', 'test']) {
  test(`logger-test se registra únicamente en desarrollo: ${nodeEnv}`, () => {
    const directory = fileURLToPath(new URL('../logs/', import.meta.url));
    const snapshot = () => existsSync(directory) ? readdirSync(directory) : null;
    const before = snapshot();
    const source = `
      import { createRequire } from 'node:module';
      import { EventEmitter, once } from 'node:events';
      import { PassThrough } from 'node:stream';
      import express from 'express';
      import mongoose from 'mongoose';
      import winston from 'winston';
      const require = createRequire(import.meta.url);
      // Solo en este proceso aislado, evita crear archivos aun con NODE_ENV de desarrollo.
      const rotatingStream = require(require.resolve('file-stream-rotator', {
        paths: [require.resolve('winston-daily-rotate-file')],
      }));
      rotatingStream.getStream = () => new PassThrough();
      const events = [];
      const log = new EventEmitter();
      for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) {
        log[level] = (...args) => events.push({ level, args });
      }
      winston.createLogger = () => log;
      mongoose.connect = async () => mongoose;
      const listen = express.application.listen;
      let server;
      express.application.listen = function (port, callback) {
        server = listen.call(this, 0, '127.0.0.1', callback);
        return server;
      };
      try {
        await import('./src/server.js');
        if (!server.listening) await once(server, 'listening');
        const origin = 'http://127.0.0.1:' + server.address().port;
        const response = await fetch(origin + '/api/logger-test?email=PRIVATE_ENDPOINT_VALUE@example.com', {
          headers: { authorization: 'PRIVATE_ENDPOINT_VALUE' },
        });
        const body = await response.json();
        const health = await fetch(origin + '/health');
        console.log(JSON.stringify({
          status: response.status, body, events, health: await health.json(),
          exitCode: process.exitCode ?? 0,
        }));
      } finally {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      env: {
        ...process.env, NODE_ENV: nodeEnv, PORT: '3000',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/unused',
      },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    const demonstration = output.events.filter(event => event.args[0].startsWith('LOGGER_DEMO_'));
    if (nodeEnv === 'development') {
      assert.equal(output.status, 200);
      assert.deepEqual(output.body, { status: 'ok' });
      assert.deepEqual(demonstration, ['debug', 'http', 'info', 'warning', 'error', 'fatal']
        .map(level => ({ level, args: ['LOGGER_DEMO_' + level.toUpperCase()] })));
      const summaries = output.events.filter(event => event.args[0].startsWith('HTTP_REQUEST')
        && event.args[0].includes('route=/api/logger-test/ '));
      assert.equal(summaries.length, 1);
      assert.equal(output.events.filter(event => event.args[0].startsWith('HTTP_ERROR')).length, 0);
    } else {
      assert.equal(output.status, 404);
      assert.deepEqual(output.body, {
        success: false,
        error: { code: 'ROUTE_NOT_FOUND', message: 'La ruta solicitada no existe.' },
      });
      assert.deepEqual(demonstration, []);
    }
    assert.deepEqual(output.health, { status: 'ok' });
    assert.equal(output.exitCode, 0);
    assert.ok(!JSON.stringify(output.events).includes('PRIVATE_ENDPOINT_VALUE'));
    assert.deepEqual(snapshot(), before);
  });
}
