# ShipNow

API académica de Backend 3 con Node.js, Express y MongoDB/Mongoose.
Products y Users utilizan Router → Controller → Service → Repository.

En Products, el router define los endpoints; el controller maneja HTTP; el service
valida la entrada, selecciona los campos de creación y traduce los errores de
validación; el repository ejecuta las operaciones de Mongoose. El modelo Product
conserva las validaciones de campos y los valores por defecto existentes.

Users sigue las mismas convenciones en `users.routes.js`, `user.controller.js`,
`user.service.js` y `user.repository.js`: el router delega, el controller maneja
HTTP, el service valida el cuerpo, selecciona los campos y normaliza el email,
y el repository concentra las operaciones de Mongoose. El modelo User se conserva.
El service traduce los errores de Mongoose sin devolver valores recibidos ni
detalles internos. Respuestas: 200 al listar, 201 al crear, 400 ante datos inválidos,
409 ante correo duplicado y 500 ante un fallo interno.

Antes de guardar un usuario válido, el repository garantiza un índice único de
email en MongoDB (se inicializa en el primer POST y se reutiliza). Esto requiere
permiso para crear índices y también protege ante solicitudes simultáneas.
Si existen duplicados previos o un índice incompatible, no se modifica ni elimina
ningún documento: el POST devuelve 500 y se debe revisar el índice/datos existentes.

## Ejecutar

1. Usar Node.js 22.21 o superior y ejecutar `npm install`.
2. Configurar `.env` en la raíz. Si falta, copiar `.env.example` a `.env`.
3. Iniciar MongoDB local o configurar una conexión de MongoDB Atlas.
4. Ejecutar `npm run dev` (reinicio automático) o `npm start`.

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/shipnow
PORT=3000
NODE_ENV=development
```

Las tres variables son obligatorias y no pueden estar vacías. `PORT` debe ser un
entero entre 1 y 65535; `NODE_ENV` admite `development`, `test` o `production`.
Si tu `.env` ya existía, agregá `NODE_ENV=development` si falta, conservando la URI.

`src/config/index.js` es el único módulo que carga dotenv y lee `process.env`.
Carga el `.env` de la raíz del proyecto y respeta las variables ya definidas en
el entorno del proceso. Exporta `config`, congelado con `Object.freeze`, con las
propiedades `port` (número), `mongodbUri` y `nodeEnv`. Una configuración inválida
detiene el arranque antes de conectar a MongoDB, indicando la variable afectada
sin imprimir su valor.

Para verificar la validación, ejecutá `npm test`. Las pruebas usan procesos aislados
y desactivan la lectura de dotenv únicamente en esos procesos: no leen ni modifican
tu `.env`, ni conectan a MongoDB. Comprueban variables ausentes, vacías y con espacios,
puertos inválidos, ambientes permitidos y la inmutabilidad del objeto exportado.

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
El email se guarda sin espacios en los extremos y en minúsculas; debe ser único.
Repetir el POST del mismo email, incluso variando mayúsculas o espacios externos,
devuelve 409.

Enviar un producto sin `name` o con precio negativo, o un usuario sin `email`,
devuelve 400. Un fallo de base de datos devuelve 500 con un mensaje genérico.
