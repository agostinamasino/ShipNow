import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';

describe('Swagger UI por HTTP sin MongoDB', () => {
  it('GET /api/docs redirige a la interfaz HTML con 200', async () => {
    const response = await request(app).get('/api/docs').redirects(1).expect(200).expect('Content-Type', /text\/html/);
    expect(response.text).to.include('id="swagger-ui"');
    expect(response.text).to.include('swagger-ui-bundle.js');
    expect(mongoose.connection.readyState).to.equal(0);
  });
  for (const [file, contentType, marker] of [
    ['swagger-ui.css', /text\/css/, '.swagger-ui'],
    ['swagger-ui-bundle.js', /javascript/, 'SwaggerUIBundle'],
    ['swagger-ui-standalone-preset.js', /javascript/, 'SwaggerUIStandalonePreset'],
    ['swagger-ui-init.js', /javascript/, 'ShipNow API'],
  ]) it(`sirve ${file} sin conexión`, async () => {
    const response = await request(app).get(`/api/docs/${file}`).expect(200).expect('Content-Type', contentType);
    expect(response.text).to.include(marker);
    expect(mongoose.connection.readyState).to.equal(0);
  });
});
