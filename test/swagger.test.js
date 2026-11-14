import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import logger from '../src/config/logger.js';
import config from '../src/config/index.js';
import openapi from '../src/config/swagger.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const logDirectory = fileURLToPath(new URL('../logs/', import.meta.url));
const logSnapshot = () => existsSync(logDirectory) ? readdirSync(logDirectory) : null;

test('OpenAPI inicial define estructura 3.0.3, versión real, tags y contenedores vacíos', () => {
  assert.equal(openapi.openapi, '3.0.3');
  assert.equal(openapi.info.title, 'ShipNow API');
  assert.equal(openapi.info.version, packageJson.version);
  assert.ok(openapi.info.description.trim());
  assert.deepEqual(openapi.tags.map(tag => tag.name),
    ['Products', 'Users', 'Orders', 'Deliveries', 'Mocks', 'Logger', 'Health']);
  assert.deepEqual(openapi.paths, {});
  assert.deepEqual(openapi.components, { schemas: {}, responses: {} });
  assert.deepEqual(openapi.servers, [{
    url: 'http://localhost:3000',
    description: 'Servidor local. El puerto se configura mediante PORT (3000 en .env.example).',
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(openapi)), openapi);
});

test('la configuración documenta el puerto efectivo sin fijarlo en 3000', () => {
  const source = 'import document from "./src/config/swagger.js";console.log(JSON.stringify(document.servers));';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, PORT: '4321', NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].url, 'http://localhost:4321');
});

test('el documento público omite configuración privada, autenticación y operaciones inexistentes', () => {
  const serialized = JSON.stringify(openapi);
  assert.ok(!serialized.includes(config.mongodbUri));
  for (const privateField of ['MONGODB_URI', 'mongodb://', 'mongodb+srv://', 'password', 'authorization']) {
    assert.ok(!serialized.includes(privateField));
  }
  assert.equal(openapi.security, undefined);
  assert.equal(openapi.components.securitySchemes, undefined);
});

test('server sirve HTML, CSS y scripts de Swagger UI aunque falle la conexión MongoDB', async (t) => {
  const before = logSnapshot();
  const connect = t.mock.method(mongoose, 'connect', async () => {
    throw new Error('PRIVATE_MONGODB_CONNECTION_VALUE');
  });
  const listen = express.application.listen;
  let server;
  t.mock.method(express.application, 'listen', function (_port, callback) {
    server = listen.call(this, 0, '127.0.0.1', callback);
    return server;
  });
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    logger.close();
    assert.deepEqual(logSnapshot(), before);
  });
  await import('../src/server.js');
  if (!server.listening) await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/docs');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /id="swagger-ui"/);
  for (const resource of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'swagger-ui-init.js']) {
    assert.ok(html.includes('./' + resource));
    const asset = await fetch(origin + '/api/docs/' + resource);
    assert.equal(asset.status, 200, resource);
    assert.match(asset.headers.get('content-type'), resource.endsWith('.css') ? /text\/css/ : /javascript/);
    const content = await asset.text();
    assert.ok(content.length > 100);
    if (resource === 'swagger-ui-init.js') {
      let options;
      const SwaggerUIBundle = received => { options = received; return {}; };
      SwaggerUIBundle.presets = { apis: {} };
      SwaggerUIBundle.plugins = { DownloadUrl: {} };
      const window = { location: { search: '', origin } };
      runInNewContext(content, { window, SwaggerUIBundle, SwaggerUIStandalonePreset: {} }, { timeout: 1000 });
      window.onload();
      assert.deepEqual(JSON.parse(JSON.stringify(options.spec)), openapi);
      assert.equal(options.validatorUrl, null);
      assert.ok(!content.includes('PRIVATE_MONGODB_CONNECTION_VALUE'));
    }
  }
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(mongoose.connection.readyState, 0);
  const health = await fetch(origin + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const missing = await fetch(origin + '/api/no-existe');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'La ruta solicitada no existe.' },
  });
});
