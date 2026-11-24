import assert from 'node:assert/strict';
export function assertHealth(body, environment = 'test') {
  assert.deepEqual(Object.keys(body).sort(), ['environment', 'status', 'timestamp', 'uptime']);
  assert.equal(body.status, 'ok');
  assert.equal(body.environment, environment);
  assert.equal(typeof body.uptime, 'number');
  assert.ok(Number.isFinite(body.uptime) && body.uptime >= 0);
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
  assert.ok(Math.abs(Date.now() - Date.parse(body.timestamp)) < 30000);
}
