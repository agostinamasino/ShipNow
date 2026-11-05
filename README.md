# ShipNow

API académica de Backend 3 con Node.js, Express y MongoDB/Mongoose.
Products y Users utilizan Router → Controller → Service → Repository.

En Products, el router define los endpoints; el controller maneja HTTP; el service
valida la entrada, selecciona los campos de creación y traduce los errores de
validación; el repository ejecuta las operaciones de Mongoose. El modelo Product
conserva las validaciones de campos; sus estados se definen mediante constantes.

Users sigue las mismas convenciones en `users.routes.js`, `user.controller.js`,
`user.service.js` y `user.repository.js`: el router delega, el controller maneja
HTTP, el service valida el cuerpo, selecciona los campos y normaliza el email,
y el repository concentra las operaciones de Mongoose. El modelo User valida los roles.
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

El servidor escucha mientras intenta conectarse a MongoDB. Si la conexión inicial
falla, los GET de mocks y `/health` siguen disponibles. Products y Users requieren
MongoDB para leer o guardar documentos.

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
  "status": "available"
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
un entero no negativo. Valores por defecto: `description: ""`, `stock: 0`, `status: "available"`.
User requiere `name` y un `email` con formato básico válido; `role` vale `user` por
defecto y admite `admin`, `user` o `courier`. No hay autenticación ni permisos asociados.
El email se guarda sin espacios en los extremos y en minúsculas; debe ser único.
Repetir el POST del mismo email, incluso variando mayúsculas o espacios externos,
devuelve 409.

Enviar un producto sin `name` o con precio negativo, o un usuario sin `email`,
devuelve 400. Un fallo de base de datos devuelve 500 con un mensaje genérico.

## Constantes y compatibilidad de estados

`src/constants/index.js` exporta dos objetos inmutables mediante `Object.freeze`:

| Constante | Valor |
| --- | --- |
| `PRODUCT_STATUS.AVAILABLE` | `available` |
| `PRODUCT_STATUS.OUT_OF_STOCK` | `out_of_stock` |
| `USER_ROLES.ADMIN` | `admin` |
| `USER_ROLES.USER` | `user` |

Los modelos y services usan estas constantes para valores predeterminados y validaciones.
Los estados o roles no permitidos, incluidos `null` y strings vacíos, devuelven 400.

El GET de Products devuelve siempre estados String: `true` se representa como
`available` y `false` como `out_of_stock`. El repository usa `lean()` para conservar
los tipos almacenados y el service convierte copias en memoria, sin guardar cambios.
Temporalmente el POST también admite booleanos, pero los convierte antes de guardar:
todos los productos nuevos tienen `status` String. Si se omite, vale `available`.
No se deduce automáticamente el estado a partir de `stock`.

No se ejecuta una migración ni se modifican documentos previos. Un estado histórico
fuera de los booleanos y strings admitidos requiere revisión manual; no se corrige
silenciosamente (GET responde 500). Los roles históricos tampoco se migran.

`npm test` incluye las 24 pruebas de configuración y pruebas sin base de datos para
la inmutabilidad de constantes, estados heredados, enums de modelos y validación
del service. Las pruebas automatizadas no modifican Atlas ni el `.env` real.

## Vistas previas de mocks

Cada GET admite `qty` como entero entre 0 y 100 (10 por defecto). Cero devuelve
listas vacías. Un valor inválido o repetido devuelve 400.

| Ejemplo | Listas en la respuesta |
| --- | --- |
| GET `/api/mocks/users?qty=2` | `users` |
| GET `/api/mocks/couriers?qty=2` | `couriers` |
| GET `/api/mocks/orders?qty=2` | `orders`, `users` |
| GET `/api/mocks/deliveries?qty=2` | `deliveries`, `orders`, `users`, `couriers` |

Los datos se generan en memoria. En cada respuesta, `userId`, `orderId` y
`courierId` coinciden con los `_id` de las listas relacionadas de esa respuesta.
Cada llamada genera un lote independiente. Una entrega asignada o en tránsito
se vincula a un pedido en curso. Una entrega completada se vincula a un pedido entregado.
