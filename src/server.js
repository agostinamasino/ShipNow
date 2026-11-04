import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import productsRouter from './routes/products.routes.js';
import usersRouter from './routes/users.routes.js';

const app = express();
const port = Number(process.env.PORT || 3000);

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
  if (!process.env.MONGODB_URI) {
    throw new Error('Falta configurar MONGODB_URI en el archivo .env.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un número entero entre 1 y 65535.');
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('Conexión a MongoDB establecida.');
  app.listen(port, () => {
    console.log(`ShipNow escuchando en http://localhost:${port}`);
  });
} catch {
  console.error('No se pudo iniciar ShipNow. Revisá PORT, MONGODB_URI y que MongoDB esté disponible.');
  await mongoose.disconnect();
  process.exitCode = 1;
}
