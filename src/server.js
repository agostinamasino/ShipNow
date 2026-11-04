import config from './config/index.js';
import express from 'express';
import mongoose from 'mongoose';
import productsRouter from './routes/products.routes.js';
import usersRouter from './routes/users.routes.js';

const app = express();

app.use(express.json());
app.use('/api/products', productsRouter);
app.use('/api/users', usersRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo debe ser JSON válido.' });
  }
  res.status(500).json({ error: 'Error interno del servidor.' });
});

try {
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
  console.log('Conexión a MongoDB establecida.');
  app.listen(config.port, () => {
    console.log(`ShipNow escuchando en http://localhost:${config.port}`);
  });
} catch {
  console.error('No se pudo iniciar ShipNow. Revisá PORT, MONGODB_URI y que MongoDB esté disponible.');
  await mongoose.disconnect();
  process.exitCode = 1;
}
