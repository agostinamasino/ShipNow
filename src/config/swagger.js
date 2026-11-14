import { readFileSync } from 'node:fs';
import config from './index.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'ShipNow API',
    version,
    description: 'API académica de logística con usuarios y productos. Incluye modelos de pedidos y entregas, vistas previas de datos simulados y carga transaccional de lotes de prueba.',
  },
  servers: [{
    url: `http://localhost:${config.port}`,
    description: 'Servidor local. El puerto se configura mediante PORT (3000 en .env.example).',
  }],
  tags: [
    { name: 'Products', description: 'Productos.' },
    { name: 'Users', description: 'Usuarios y roles.' },
    { name: 'Orders', description: 'Pedidos relacionados dentro del módulo de mocks, sin CRUD propio.' },
    { name: 'Deliveries', description: 'Entregas relacionadas dentro del módulo de mocks, sin CRUD propio.' },
    { name: 'Mocks', description: 'Generación en memoria y carga de datos de prueba.' },
    { name: 'Logger', description: 'Demostración de logging disponible solo en desarrollo.' },
    { name: 'Health', description: 'Respuesta del servidor.' },
  ],
  components: {
    schemas: {},
    responses: {},
  },
  paths: {},
};

export default openapi;
