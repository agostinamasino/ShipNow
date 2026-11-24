import { assertHealth } from '../../test-support/health.js';
import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';

describe('GET /health', () => {
  it('responde 200 con el estado exacto en JSON, sin MongoDB', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200)
      .expect('Content-Type', /application\/json/);

    assertHealth(response.body);
  });
});
