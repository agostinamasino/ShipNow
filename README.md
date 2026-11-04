# ShipNow

API académica de Backend 3 con Node.js, Express y MongoDB/Mongoose.
En esta etapa las consultas están directamente en las rutas, antes de refactorizar a capas.

## Ejecutar

1. Usar Node.js 22.21 o superior y ejecutar `npm install`.
2. Configurar `.env` en la raíz. Si falta, copiar `.env.example` a `.env`.
3. Iniciar MongoDB local o configurar una conexión de MongoDB Atlas.
4. Ejecutar `npm run dev` (reinicio automático) o `npm start`.

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/shipnow
PORT=3000
```

Para MongoDB local, instalar MongoDB Community y mantener su servicio en ejecución.
La base `shipnow` y sus colecciones se crean al guardar los primeros documentos.
Para Atlas, crear un cluster, un usuario de base de datos y permitir la IP del equipo
en Network Access. Copiar la URI de Connect → Drivers a `MONGODB_URI`, incluyendo
el nombre de base `shipnow`, y reemplazar las credenciales. Codificar los caracteres
especiales de la contraseña para una URL. No compartir `.env`: Git lo ignora.

El servidor escucha después de conectarse a MongoDB. Si la conexión inicial falla,
sale con código 1. `/health` informa que el servidor responde; no consulta la base.

## Probar con Postman o Thunder Client

URL base: `http://localhost:3000` (ajustar si cambia PORT).
Para POST, elegir Body → raw → JSON y `Content-Type: application/json`.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/health` | 200, `{"status":"ok"}` |
| GET | `/api/products` | 200, array de productos |
| POST | `/api/products` | 201, producto guardado |
| GET | `/api/users` | 200, array de usuarios |
| POST | `/api/users` | 201, usuario guardado |

Producto de ejemplo:

```json
{
  "name": "Caja mediana",
  "description": "Caja para envíos",
  "price": 1500,
  "stock": 20,
  "status": true
}
```

Usuario de ejemplo:

```json
{
  "name": "Ana Pérez",
  "email": "ana@example.com",
  "role": "user"
}
```

Después de cada POST, ejecutar el GET correspondiente para comprobar la persistencia.
Los documentos incluyen `_id` y `__v` generados por Mongoose.

Product requiere `name` y `price`; `price` no puede ser negativo, `stock` debe ser
un entero no negativo. Valores por defecto: `description: ""`, `stock: 0`, `status: true`.
User requiere `name` y un `email` con formato básico válido; `role` vale `user` por
defecto y es texto libre en esta etapa. No hay autenticación ni permisos asociados.
El email se guarda en minúsculas y todavía no se exige que sea único.

Enviar un producto sin `name` o con precio negativo, o un usuario sin `email`,
devuelve 400. Un fallo de base de datos devuelve 500 con un mensaje genérico.
