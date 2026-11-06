import config from './config/index.js';
import express from 'express';
import mongoose from 'mongoose';
import productsRouter from './routes/products.routes.js';
import usersRouter from './routes/users.routes.js';
import mocksRouter from './routes/mocks.routes.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';

const app = express();

app.use(express.json());
app.use('/api/products', productsRouter);
app.use('/api/users', usersRouter);
app.use('/api/mocks', mocksRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log(`ShipNow escuchando en http://localhost:${config.port}`);
  mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('Conexión a MongoDB establecida.'))
    .catch(() => console.error('No se pudo conectar a MongoDB. Los endpoints de mocks siguen disponibles.'));
});
