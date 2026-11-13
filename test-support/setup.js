// Se ejecuta solo mediante npm test, antes de importar módulos de la aplicación.
// Las variables heredadas o el .env local no pueden habilitar logs ni conexiones reales.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/shipnow_test_unused',
});
