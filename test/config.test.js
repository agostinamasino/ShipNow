import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const configUrl = new URL('../src/config/index.js', import.meta.url).href;
const dotenvUrl = import.meta.resolve('dotenv');
const valid = {
  PORT: '3000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/shipnow_test',
  NODE_ENV: 'test',
};

function load(env) {
  // Evita leer el .env real. Cada import ocurre en un proceso nuevo.
  const source = `
    import dotenv from ${JSON.stringify(dotenvUrl)};
    dotenv.config = () => ({});
    try {
      const { default: config } = await import(${JSON.stringify(configUrl)});
      const frozen = Object.isFrozen(config);
      let mutationRejected = false;
      try { config.port = 9999; } catch { mutationRejected = true; }
      console.log(JSON.stringify({ config, frozen, mutationRejected }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

for (const key of Object.keys(valid)) {
  for (const value of [undefined, '', '   ']) {
    test(`${key}: rechaza ${JSON.stringify(value) ?? 'ausencia'}`, () => {
      const env = { ...valid };
      if (value === undefined) delete env[key];
      else env[key] = value;
      const result = load(env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(key));
      assert.match(result.stderr, /obligatoria/);
      assert.ok(!result.stderr.includes(valid.MONGODB_URI));
    });
  }
}

for (const value of ['0', '65536', '-1', '1.5', 'abc', 'Infinity', '0xBB8', '3e3']) {
  test(`PORT: rechaza ${value}`, () => {
    const result = load({ ...valid, PORT: value });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PORT.*entero entre 1 y 65535/);
  });
}

for (const value of ['1', '3000', '65535']) {
  test(`PORT: admite ${value} como número`, () => {
    const result = load({ ...valid, PORT: value });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).config.port, Number(value));
  });
}

for (const value of ['development', 'test', 'production']) {
  test(`NODE_ENV: admite ${value} y congela config`, () => {
    const result = load({ ...valid, NODE_ENV: value });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.deepEqual(data.config, { port: 3000, mongodbUri: valid.MONGODB_URI, nodeEnv: value });
    assert.equal(data.frozen, true);
    assert.equal(data.mutationRejected, true);
  });
}

test('NODE_ENV: rechaza un ambiente no permitido', () => {
  const result = load({ ...valid, NODE_ENV: 'staging' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_ENV.*development, test o production/);
});
