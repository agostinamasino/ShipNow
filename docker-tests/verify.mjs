// Integración real, explícita y separada de npm test. No utiliza .env ni Atlas.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

let executable = 'docker';
let image = 'shipnow:m8';
let hasExecutable = false, hasImage = false;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--help') {
    console.log('Uso: node docker-tests/verify.mjs [ruta-docker] [--image repositorio:etiqueta]');
    process.exit(0);
  }
  if (argument === '--image') {
    if (hasImage || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error('Indicar --image una sola vez y con una etiqueta válida.');
    }
    image = process.argv[++index]; hasImage = true;
  } else if (!argument.startsWith('-') && !hasExecutable) {
    executable = argument; hasExecutable = true;
  } else throw new Error('Argumento no reconocido. Consultar --help.');
}
// Referencias por nombre/tag, opcionalmente con registry y puerto; sin digest ni espacios.
const imageReference = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/;
if (image.length > 255 || !imageReference.test(image)) {
  throw new Error('Imagen inválida: usar un nombre/tag Docker sin espacios, credenciales ni opciones.');
}
const names = {
  network: 'shipnow-m8-test', mongo: 'shipnow-m8-mongo', api: 'shipnow-m8-api',
  missing: 'shipnow-m8-missing-config', unavailable: 'shipnow-m8-unavailable',
  uploads: 'shipnow-m8-test-uploads', logs: 'shipnow-m8-test-logs',
};
const token = randomUUID();
const label = `shipnow.m8.integration=${token}`;
const created = { containers: new Set(), volumes: new Set(), network: false };
const results = [];
// Un plazo global referenciado también mantiene vivo Node mientras fetch espera I/O.
const overall = new AbortController();
const deadline = setTimeout(() => overall.abort(new Error('La integración excedió 120 segundos.')), 120000);
let temporary, origin, hostPort;
function command(args, { allowFailure = false, timeout = 60000 } = {}) {
  const result = spawnSync(executable, args, { shell: false, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Docker ${args[0]} falló: ${result.error?.message ?? result.stderr}`);
  return result;
}
const docker = (...args) => command(args).stdout.trim();
const inspect = name => JSON.parse(docker('inspect', name))[0];
const execNode = (name, source) => docker('exec', name, 'node', '--input-type=module', '-e', source);
async function check(name, fn) { await fn(); results.push(name); console.log(`OK ${name}`); }
async function waitFor(fn, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await delay(300); }
  throw new Error('Se agotó la espera de un recurso temporal.');
}
function ownedContainer(name) { return inspect(name).Config.Labels?.['shipnow.m8.integration'] === token; }
function removeContainer(name) {
  if (!created.containers.has(name)) return;
  assert.ok(ownedContainer(name), 'Se rechaza eliminar un contenedor ajeno');
  docker('rm', '-f', '-v', name); created.containers.delete(name);
}
async function freePort() {
  const listen = port => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
  });
  try { return await listen(3000); } catch { return listen(0); }
}
function startApi(useFlags = false) {
  const configuration = useFlags
    ? ['--env', 'NODE_ENV=production', '--env', 'PORT=3107', '--env', 'LOG_LEVEL=info', '--env', 'MONGODB_URI=mongodb://shipnow-m8-mongo:27017/shipnow_m8_test']
    : ['--env-file', path.join(temporary, 'runtime.env')];
  docker('run', '-d', '--init', '--name', names.api, '--label', label, '--network', names.network,
    ...configuration, '-p', `127.0.0.1:${hostPort}:3107`,
    '--mount', `type=volume,source=${names.uploads},target=/app/uploads`,
    '--mount', `type=volume,source=${names.logs},target=/app/logs`, image);
  created.containers.add(names.api);
}
async function request(url, expected, options) {
  const response = await fetch(origin + url, { ...options, signal: AbortSignal.any([overall.signal, AbortSignal.timeout(10000)]) });
  assert.equal(response.status, expected, url);
  return response;
}
async function create(url, body) {
  return (await request(url, 201, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
}
function logsContainMarker() {
  return JSON.parse(execNode(names.api, `import fs from 'node:fs'; const files=fs.readdirSync('/app/logs').filter(n=>/^errors-.*\\.log/.test(n)); const records=files.flatMap(n=>fs.readFileSync('/app/logs/'+n,'utf8').split(/\\r?\\n/).filter(Boolean).map(JSON.parse)); console.log(JSON.stringify(records.some(r=>r.level==='error'&&r.message==='DOCKER_PERSISTENCE_PROBE')));`));
}

try {
  await check('nombres libres y motor Linux', async () => {
    assert.equal(docker('info', '--format', '{{.OSType}}'), 'linux');
    for (const name of [names.api, names.mongo, names.missing, names.unavailable]) assert.notEqual(command(['container', 'inspect', name], { allowFailure: true }).status, 0, `Ya existe ${name}`);
    assert.notEqual(command(['network', 'inspect', names.network], { allowFailure: true }).status, 0);
    for (const name of [names.uploads, names.logs]) assert.notEqual(command(['volume', 'inspect', name], { allowFailure: true }).status, 0);
  });
  await check('imagen productiva: usuario, dependencias y exclusiones', async () => {
    const data = JSON.parse(docker('run', '--rm', image, 'node', '-e', `const fs=require('fs'); const p=require('./package.json'); const forbidden=[]; function walk(dir){ for(const e of fs.readdirSync(dir,{withFileTypes:true})){ if(e.name==='node_modules')continue; const f=dir+'/'+e.name; if(/^\\.env|^\\.git$|^test$|^tests$|^test-support$/.test(e.name))forbidden.push(f); if(e.isDirectory())walk(f); }} walk('/app'); console.log(JSON.stringify({node:process.version,uid:process.getuid(),forbidden,dev:Object.keys(p.devDependencies).filter(n=>fs.existsSync('node_modules/'+n)),prod:Object.keys(p.dependencies).every(n=>fs.existsSync('node_modules/'+n)),uploads:fs.readdirSync('uploads'),logs:fs.readdirSync('logs')}));`));
    assert.ok(Number(data.node.split('.')[1]) >= 21); assert.equal(data.uid, 1000);
    assert.deepEqual(data.forbidden, []); assert.deepEqual(data.dev, []); assert.ok(data.prod);
    assert.deepEqual(data.uploads, []); assert.deepEqual(data.logs, []);
    const metadata = JSON.parse(docker('image', 'inspect', image))[0];
    assert.ok(!metadata.Config.Env.some(value => value.startsWith('MONGODB_URI=')));
    assert.ok(!docker('history', '--no-trunc', image).includes('MONGODB_URI='));
    console.log(JSON.stringify({ node: data.node, uid: data.uid, imageBytes: metadata.Size }));
  });
  temporary = await mkdtemp(path.join(tmpdir(), 'shipnow-docker-'));
  await writeFile(path.join(temporary, 'runtime.env'), 'NODE_ENV=production\nPORT=3107\nLOG_LEVEL=info\nMONGODB_URI=mongodb://shipnow-m8-mongo:27017/shipnow_m8_test\n');
  docker('network', 'create', '--label', label, names.network); created.network = true;
  for (const name of [names.uploads, names.logs]) { docker('volume', 'create', '--label', label, name); created.volumes.add(name); }
  docker('run', '-d', '--name', names.mongo, '--label', label, '--network', names.network, 'mongo:8.0'); created.containers.add(names.mongo);
  await check('MongoDB aislado disponible sin puerto publicado', async () => {
    await waitFor(() => command(['exec', names.mongo, 'mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1}).ok'], { allowFailure: true }).status === 0);
    assert.deepEqual(inspect(names.mongo).HostConfig.PortBindings, {});
  });
  hostPort = await freePort(); origin = `http://127.0.0.1:${hostPort}`;
  startApi();
  await check('health productivo y puerto externo configurable', async () => {
    await waitFor(async () => { try { return (await fetch(origin + '/health', { signal: AbortSignal.any([overall.signal, AbortSignal.timeout(2000)]) })).ok; } catch { return false; } });
    const response = await request('/health', 200), body = await response.json();
    assert.equal(body.status, 'ok'); assert.equal(body.environment, 'production'); assert.ok(body.uptime >= 0);
    assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
    assert.deepEqual(Object.keys(body).sort(), ['environment', 'status', 'timestamp', 'uptime']);
    assert.equal(inspect(names.api).Config.User, 'node');
    console.log(JSON.stringify({ origin, containerPort: 3107, health: body }));
  });
  await check('HEALTHCHECK Docker respeta PORT=3107', async () => {
    await waitFor(() => inspect(names.api).State.Health.Status === 'healthy', 45000);
  });
  await check('Swagger HTML y recursos auxiliares', async () => {
    assert.match(await (await request('/api/docs/', 200)).text(), /swagger-ui/);
    for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'swagger-ui-init.js']) {
      const response = await request('/api/docs/' + file, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 100);
    }
  });
  await check('listados iniciales paginados y vacíos', async () => {
    for (const resource of ['products', 'users', 'orders']) assert.deepEqual(await (await request('/api/' + resource, 200)).json(), { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
  });
  await check('seis endpoints internos deshabilitados', async () => {
    for (const resource of ['users', 'couriers', 'orders', 'deliveries', 'seed', 'logger']) {
      const url = resource === 'logger' ? '/api/logger-test' : '/api/mocks/' + resource;
      const response = await request(url, 404, resource === 'seed' ? { method: 'POST' } : undefined);
      assert.equal((await response.json()).error.code, 'ROUTE_NOT_FOUND');
    }
  });
  let user, file;
  const bytes = Buffer.from('%PDF-1.7\nShipNow Docker fictitious fixture\n');
  await check('persistencia real de User, Product y Order', async () => {
    user = await create('/api/users', { name: 'Usuario ficticio Docker', email: 'docker.test@example.com' });
    await create('/api/products', { name: 'Caja ficticia Docker', price: 1500, stock: 20 });
    await create('/api/orders', { userId: user._id, destinationAddress: 'Dirección ficticia de prueba' });
    for (const resource of ['products', 'users', 'orders']) {
      const body = await (await request('/api/' + resource + '?page=1&limit=1', 200)).json();
      assert.equal(body.data.length, 1); assert.deepEqual(body.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    }
    const counts = JSON.parse(docker('exec', names.mongo, 'mongosh', '--quiet', '--eval', "const t=db.getSiblingDB('shipnow_m8_test'); print(JSON.stringify({users:t.users.countDocuments(),products:t.products.countDocuments(),orders:t.orders.countDocuments()}));"));
    assert.deepEqual(counts, { users: 1, products: 1, orders: 1 });
  });
  await check('carga, metadata y descarga exacta con usuario no root', async () => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'fixture.pdf'); form.append('documentType', 'identity');
    file = await (await request(`/api/users/${user._id}/documents`, 201, { method: 'POST', body: form })).json();
    assert.equal(file.ownerId, user._id); assert.equal(file.ownerModel, 'User');
    const listed = await (await request(`/api/users/${user._id}/documents`, 200)).json();
    assert.equal(listed.pagination.total, 1); assert.equal(listed.data[0]._id, file._id);
    const response = await request(`/api/files/${file._id}/download`, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(execNode(names.api, `import fs from 'node:fs'; console.log(fs.readFileSync('/app/uploads/'+${JSON.stringify(file.path)}).toString('base64'));`), bytes.toString('base64'));
    const count = docker('exec', names.mongo, 'mongosh', '--quiet', '--eval', "db.getSiblingDB('shipnow_m8_test').uploadedfiles.countDocuments()"); assert.equal(count, '1');
  });
  await check('carga inválida responde 415 y limpia temporales', async () => {
    const form = new FormData(); form.append('documentType', 'identity'); form.append('file', new Blob([bytes], { type: 'image/png' }), 'fake.png');
    const response = await request(`/api/users/${user._id}/documents`, 415, { method: 'POST', body: form });
    assert.equal((await response.json()).error.code, 'FILE_INVALID_TYPE');
    assert.equal(execNode(names.api, "import fs from 'node:fs'; console.log(fs.readdirSync('/app/uploads/staging').length);"), '0');
  });
  await check('evento Winston controlado persistido en volumen', async () => {
    execNode(names.api, "import logger from './src/config/logger.js'; logger.error('DOCKER_PERSISTENCE_PROBE'); await new Promise(resolve=>{logger.once('finish',resolve);logger.end()});logger.close();");
    assert.ok(logsContainMarker());
  });
  await check('docker stop: salida 0 dentro del plazo y reemplazo de API', async () => {
    const start = Date.now(); docker('stop', '--timeout', '15', names.api);
    const exitCode = inspect(names.api).State.ExitCode;
    if (exitCode !== 0) { const output = command(['logs', names.api]); console.error(output.stdout, output.stderr); }
    assert.ok(Date.now() - start < 15000); assert.equal(exitCode, 0);
    removeContainer(names.api); startApi(true);
    await waitFor(async () => { try { return (await fetch(origin + '/health', { signal: AbortSignal.any([overall.signal, AbortSignal.timeout(2000)]) })).ok; } catch { return false; } });
    console.log(JSON.stringify({ stopMilliseconds: Date.now() - start }));
  });
  await check('archivo, metadata y logs sobreviven al reemplazo', async () => {
    const response = await request(`/api/files/${file._id}/download`, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes); assert.ok(logsContainMarker());
    const body = await (await request(`/api/users/${user._id}/documents`, 200)).json(); assert.equal(body.pagination.total, 1);
  });
  await check('configuración crítica ausente: salida no cero', async () => {
    docker('create', '--name', names.missing, '--label', label, '--network', names.network, image); created.containers.add(names.missing);
    command(['start', '-a', names.missing], { allowFailure: true });
    assert.notEqual(inspect(names.missing).State.ExitCode, 0);
    assert.ok(!docker('logs', names.missing).includes('SERVER_LISTENING'));
  });
  await check('MongoDB no disponible: fatal saneado, salida no cero y sin escucha previa', async () => {
    docker('run', '-d', '--init', '--name', names.unavailable, '--label', label, '--network', names.network, '--env', 'MONGODB_URI=mongodb://127.0.0.1:1/shipnow_m8_test', image); created.containers.add(names.unavailable);
    assert.equal(command(['exec', names.unavailable, 'node', '-e', "const s=require('net').connect(3000,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(0));"], { allowFailure: true }).status, 0);
    await waitFor(() => !inspect(names.unavailable).State.Running, 20000);
    assert.notEqual(inspect(names.unavailable).State.ExitCode, 0);
    const logs = docker('logs', names.unavailable);
    assert.ok(logs.includes('fatal')); assert.ok(logs.includes('diagnostic')); assert.ok(!logs.includes('SERVER_LISTENING'));
    assert.ok(!logs.includes('mongodb://'));
  });
  console.log(JSON.stringify({ image, checksPassed: results.length, hostPort, resources: names }));
} finally {
  for (const name of [...created.containers].reverse()) {
    if (ownedContainer(name) && inspect(name).State.Running) command(['stop', '--timeout', '15', name], { allowFailure: true });
    removeContainer(name);
  }
  for (const name of created.volumes) {
    const volume = JSON.parse(docker('volume', 'inspect', name))[0]; assert.equal(volume.Labels['shipnow.m8.integration'], token); docker('volume', 'rm', name);
  }
  if (created.network) { const network = JSON.parse(docker('network', 'inspect', names.network))[0]; assert.equal(network.Labels['shipnow.m8.integration'], token); docker('network', 'rm', names.network); }
  if (temporary) {
    const target = await realpath(temporary), root = await realpath(tmpdir());
    assert.equal(path.dirname(target), root); assert.ok(path.basename(target).startsWith('shipnow-docker-'));
    await rm(target, { recursive: true, force: true });
  }
  console.log(`Limpieza de recursos propios finalizada; imagen ${image} conservada.`);
  clearTimeout(deadline);
}
