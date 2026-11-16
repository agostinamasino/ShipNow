# ShipNow

API académica de Backend 3 con Node.js, Express y MongoDB/Mongoose.
Products, Users, Orders y mocks siguen la arquitectura por capas.

| Capa | Responsabilidad |
| --- | --- |
| Router | Define los endpoints y delega en el controller. |
| Controller | Lee la solicitud y construye la respuesta exitosa. Express 5 propaga las excepciones y los rechazos al middleware global. |
| Service | Aplica las reglas de negocio y detecta errores conocidos mediante `AppError`. |
| Repository | Concentra las operaciones de persistencia con Mongoose. Las vistas previas de mocks se generan en memoria. |
| Model | Define el esquema, las validaciones de persistencia y las referencias. |
| Middleware global | Construye las respuestas de error usando el catálogo centralizado. |

Separar Service y Repository permite probar las reglas de negocio con la
persistencia simulada y mantiene las consultas a MongoDB aisladas de esas reglas.

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

Orders mantiene la misma separación en `orders.routes.js`, `order.controller.js`,
`order.service.js` y `order.repository.js`. El service valida los datos y exige un
usuario existente con rol USER; el repository consulta únicamente `_id` y `role`
del usuario. Los errores se propagan al middleware global.

`src/app.js` configura y exporta Express con sus routers, Swagger y middlewares,
sin abrir puertos ni conectar MongoDB. `src/server.js` importa esa aplicación,
inicia el servidor HTTP, intenta la conexión y registra los eventos de arranque.
Importar la aplicación para pruebas requiere la configuración de entorno válida;
la preparación de testing la establece antes de importar los módulos.

## Ejecutar

1. Usar Node.js 22.21 o superior y ejecutar `npm install`.
2. Configurar `.env` en la raíz. Si falta, copiar `.env.example` a `.env`.
3. Iniciar MongoDB local o configurar una conexión de MongoDB Atlas.
4. Ejecutar `npm run dev` (reinicio automático) o `npm start`.

Si todavía no existe `.env`, desde la raíz del proyecto usá
`Copy-Item .env.example .env` en PowerShell o `cp .env.example .env` en
Linux/macOS. Después configurá los valores para tu entorno.

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
falla, los GET de mocks, Swagger y `/health` siguen disponibles. Products, Users y Orders requieren
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
| GET | `/api/orders` | 200, array de pedidos, posiblemente vacío |
| POST | `/api/orders` | 201, pedido guardado |
| GET | `/api/orders/:id` | 200, pedido encontrado |

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

## Pedidos (Orders)

`POST /api/orders` requiere un body objeto con `userId` y `destinationAddress`.
`userId` debe ser String hexadecimal de 24 caracteres y referenciar un usuario
existente con `USER_ROLES.USER` (`user`). ADMIN y COURIER no pueden ser el usuario
referenciado por este endpoint. La dirección debe ser String y conservar contenido
después de `trim`. Los campos adicionales se ignoran.

`status` es opcional y admite `pending`, `in_progress` o `delivered`;
`priority` admite `low`, `normal` o `high`. Sus defaults son `pending` y `normal`
solo cuando se omiten; `null`, strings vacíos y valores ajenos a las constantes
se rechazan. El endpoint permite cualquiera de los valores válidos al crear.

Body mínimo (el ID es ilustrativo; reemplazalo por un usuario USER existente):

```json
{
  "userId": "507f1f77bcf86cd799439012",
  "destinationAddress": "Calle de prueba 123"
}
```

Respuesta HTTP 201 ilustrativa:

```json
{
  "_id": "507f1f77bcf86cd799439031",
  "userId": "507f1f77bcf86cd799439012",
  "destinationAddress": "Calle de prueba 123",
  "status": "pending",
  "priority": "normal",
  "__v": 0
}
```

`GET /api/orders` devuelve un array sin orden garantizado; si no hay registros,
devuelve `[]`. `GET /api/orders/:id` devuelve un documento. Las referencias se
representan como IDs, sin expandir los datos personales del usuario.

Los datos inválidos devuelven 400; un usuario referenciado inexistente o un pedido
inexistente devuelven 404 con códigos diferentes. Un ID mal formado en la ruta
devuelve 400 antes de consultar la base. Los fallos inesperados devuelven 500.
El parser también aplica `INVALID_JSON` (incluido JSON `null`) y el límite de 100 KB.

No existe PATCH de estados ni CRUD independiente de Deliveries. La consigna pide
actualizar estados «si aplica»: el alcance actual no define transiciones ni reglas
de sincronización entre un pedido y sus entregas. Se prueba la validación de enums
al crear, sin introducir una operación de actualización ni transiciones inventadas.
Crear un pedido tampoco crea o modifica entregas.

Para probar manualmente en una base de prueba con MongoDB conectado, los siguientes
comandos insertan un pedido. Usá el ID de un usuario USER existente.

```powershell
$base = 'http://localhost:3000'
$userId = '507f1f77bcf86cd799439012' # Reemplazar por un ID existente
$pedido = Invoke-RestMethod -Method Post -Uri "$base/api/orders" -ContentType 'application/json' -Body (@{ userId = $userId; destinationAddress = 'Calle de prueba 123' } | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/api/orders"
Invoke-RestMethod -Uri "$base/api/orders/$($pedido._id)"
```

```sh
base='http://localhost:3000'
userId='507f1f77bcf86cd799439012' # Reemplazar por un ID existente
curl -i "$base/api/orders" -H 'Content-Type: application/json' --data "{\"userId\":\"$userId\",\"destinationAddress\":\"Calle de prueba 123\"}"
curl -i "$base/api/orders"
# Reemplazar por el _id devuelto en el POST
orderId='507f1f77bcf86cd799439031'
curl -i "$base/api/orders/$orderId"
```

## Constantes y compatibilidad de estados

`src/constants/index.js` exporta cinco objetos de dominio y cuatro objetos de
archivos inmutables mediante `Object.freeze`. Los de dominio son:

| Constante | Valor |
| --- | --- |
| `PRODUCT_STATUS.AVAILABLE` | `available` |
| `PRODUCT_STATUS.OUT_OF_STOCK` | `out_of_stock` |
| `USER_ROLES.ADMIN` | `admin` |
| `USER_ROLES.USER` | `user` |
| `USER_ROLES.COURIER` | `courier` |
| `ORDER_STATUS.PENDING` | `pending` |
| `ORDER_STATUS.IN_PROGRESS` | `in_progress` |
| `ORDER_STATUS.DELIVERED` | `delivered` |
| `DELIVERY_STATUS.ASSIGNED` | `assigned` |
| `DELIVERY_STATUS.IN_TRANSIT` | `in_transit` |
| `DELIVERY_STATUS.DELIVERED` | `delivered` |
| `ORDER_PRIORITY.LOW` | `low` |
| `ORDER_PRIORITY.NORMAL` | `normal` |
| `ORDER_PRIORITY.HIGH` | `high` |

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

Cada GET genera datos en memoria sin guardarlos en MongoDB. Devuelve HTTP 200 y
admite `qty` como entero entre 0 y 100 (10 por defecto). Cero devuelve listas
vacías. Un valor inválido o repetido devuelve HTTP 400.

| Ejemplo | Listas en la respuesta |
| --- | --- |
| GET `/api/mocks/users?qty=2` | `users` |
| GET `/api/mocks/couriers?qty=2` | `couriers` |
| GET `/api/mocks/orders?qty=2` | `orders`, `users` |
| GET `/api/mocks/deliveries?qty=2` | `deliveries`, `orders`, `users`, `couriers` |

Cada llamada genera un lote independiente. En la misma respuesta, el `userId`
del pedido apunta al `_id` de un usuario con rol `user`. El `orderId` de la
entrega apunta al `_id` del pedido y su `courierId` al `_id` de un usuario con
rol `courier`. Una entrega asignada o en tránsito se vincula a un pedido en
curso. Una entrega completada se vincula a un pedido entregado.

Ejemplo completo de HTTP 200 para `GET /api/mocks/deliveries?qty=1`. Los IDs y
correos cambian entre llamadas.

```json
{
  "deliveries": [
    {
      "_id": "187e54ad6dd2127246e6b78b",
      "orderId": "f92e7bf10f417ecd74041ed6",
      "courierId": "d72f4a81677b6a70a5f6333a",
      "status": "assigned"
    }
  ],
  "orders": [
    {
      "_id": "f92e7bf10f417ecd74041ed6",
      "userId": "1695bde34b1044f1aab65cd3",
      "status": "in_progress",
      "priority": "normal",
      "destinationAddress": "Calle de prueba 1"
    }
  ],
  "users": [
    {
      "_id": "1695bde34b1044f1aab65cd3",
      "name": "Usuario de prueba 1",
      "email": "user.81ad7166-4578-4b74-82b5-8988347dc9db.1@example.com",
      "role": "user"
    }
  ],
  "couriers": [
    {
      "_id": "d72f4a81677b6a70a5f6333a",
      "name": "Repartidor de prueba 1",
      "email": "courier.91b6b66b-d666-40f2-91f0-f3d5571be8f7.1@example.com",
      "role": "courier"
    }
  ]
}
```

## Cargar un lote de prueba

`POST /api/mocks/seed` inserta documentos en MongoDB. Por ejemplo,
`POST /api/mocks/seed?qty=10` inserta **10 usuarios, 10 repartidores, 10 pedidos
y 10 entregas**. El total es cuatro veces `qty`, por lo que el máximo es
`qty=25` (100 documentos en el lote) y el mínimo es `qty=1`.

Como alternativa, enviá `POST /api/mocks/seed` con `Content-Type: application/json`
y cantidades explícitas:

```json
{"users":2,"couriers":2,"orders":3,"deliveries":3}
```

Los campos omitidos cuentan como cero. El total debe ser de 1 a 100 documentos,
con cantidades enteras no negativas. Los pedidos requieren al menos un usuario.
Las entregas requieren al menos un repartidor y un pedido distinto por entrega.
Los usuarios y repartidores se asignan en rotación dentro del mismo lote.
Combinar `qty` en la URL con un body que incluya cantidades devuelve HTTP 400.

Una respuesta **201** incluye `batchId`, `counts` e `ids`. Los dos últimos
agrupan cantidades e IDs por `users`, `couriers`, `orders` y `deliveries`.
Cada solicitud exitosa crea un lote nuevo. Los correos usan el UUID del lote,
y todas las referencias apuntan a documentos insertados por esa solicitud.

Ejemplo completo de HTTP 201 para `POST /api/mocks/seed?qty=1`.

```json
{
  "batchId": "b984a582-156e-4fa7-a679-12e6149558bc",
  "counts": {
    "users": 1,
    "couriers": 1,
    "orders": 1,
    "deliveries": 1
  },
  "ids": {
    "users": ["6aebc0251c086be69f9d987c"],
    "couriers": ["6aebc0261c086be69f9d987d"],
    "orders": ["6aebc0261c086be69f9d987e"],
    "deliveries": ["6aebc0261c086be69f9d987f"]
  }
}
```

El seed requiere MongoDB Atlas o un replica set con soporte transaccional.
Usa una sola transacción para todo el lote. Un fallo de inserción revierte
el lote completo. Las entradas inválidas
devuelven **400**, una conexión no disponible o sin soporte transaccional **503**
y un fallo inesperado **500**. Los GET de vistas previas funcionan independientemente.

### Probar los mocks en local

Seguí los pasos de [Ejecutar](#ejecutar) y usá el puerto de `PORT` (3000 en los
ejemplos). Para las vistas previas alcanza con que el servidor esté escuchando.
Para ejecutar el seed, apuntá la configuración a una base de prueba con soporte
de transacciones y esperá a que el servidor confirme la conexión.

```powershell
curl.exe "http://localhost:3000/api/mocks/users?qty=2"
curl.exe "http://localhost:3000/api/mocks/couriers?qty=2"
curl.exe "http://localhost:3000/api/mocks/orders?qty=2"
curl.exe "http://localhost:3000/api/mocks/deliveries?qty=1"
curl.exe -X POST "http://localhost:3000/api/mocks/seed?qty=1"
```

En Linux/macOS, usá los mismos comandos reemplazando `curl.exe` por `curl`.

También podés enviar esas solicitudes desde Postman o Thunder Client. Para probar
el formato con body, usá POST sin `qty` y pegá el ejemplo de cantidades como JSON.

## Respuestas de error

El middleware global usa el catálogo de `src/errors/error.catalog.js`. El status
viaja en la respuesta HTTP. En el JSON, `error.code` identifica el error de forma
estable y `error.message` contiene el mensaje público. Algunas validaciones
incluyen `error.details.fields` con nombres de campos permitidos.

```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_VALIDATION_FAILED",
    "message": "Revisá los campos del producto.",
    "details": { "fields": ["price"] }
  }
}
```

| Código | HTTP | Situación |
| --- | --- | --- |
| `INVALID_JSON` | 400 | El parser rechaza el cuerpo como JSON. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo JSON supera el límite de 100 KB de `express.json()`. |
| `ROUTE_NOT_FOUND` | 404 | Ninguna ruta responde al método y la URL solicitados. |
| `PRODUCT_VALIDATION_FAILED` | 400 | El cuerpo o los campos del producto son inválidos. |
| `PRODUCT_INVALID_STATUS` | 400 | El estado enviado al crear un producto es inválido. |
| `USER_VALIDATION_FAILED` | 400 | El cuerpo o los campos del usuario son inválidos. |
| `USER_INVALID_ROLE` | 400 | El rol enviado al crear un usuario es inválido. |
| `USER_EMAIL_ALREADY_EXISTS` | 409 | El correo ya existe o se produce una colisión con el índice de email al guardar. |
| `ORDER_VALIDATION_FAILED` | 400 | Body inválido, userId mal formado o dirección inválida. Puede incluir campos seguros. |
| `ORDER_INVALID_ID` | 400 | El ID del pedido en la ruta no es hexadecimal de 24 caracteres. |
| `ORDER_INVALID_STATUS` | 400 | Estado inválido al crear un pedido. |
| `ORDER_INVALID_PRIORITY` | 400 | Prioridad inválida al crear un pedido. |
| `ORDER_INVALID_USER_ROLE` | 400 | El usuario referenciado no tiene rol USER. |
| `ORDER_USER_NOT_FOUND` | 404 | El usuario referenciado no existe. |
| `ORDER_NOT_FOUND` | 404 | El ID tiene formato válido pero el pedido no existe. |
| `MOCK_INVALID_QTY` | 400 | `qty` es inválido, está repetido o queda fuera del rango del endpoint. |
| `MOCK_INVALID_SEED_REQUEST` | 400 | El body o las cantidades del seed son inválidos, o se combinan cantidades del body con `qty`. |
| `MOCK_INVALID_SEED_RELATIONS` | 400 | Faltan usuarios para los pedidos o faltan pedidos distintos o repartidores para las entregas. |
| `MOCK_SEED_UNAVAILABLE` | 503 | MongoDB no está disponible para el seed o rechaza la operación transaccional por falta de soporte. |
| `INTERNAL_ERROR` | 500 | Fallo inesperado. El mensaje público es genérico. |
| `FILE_REQUIRED` | 400 | Falta el archivo obligatorio. |
| `FILE_INVALID_TYPE` | 415 | MIME, extensión o firma básica no permitidos o incoherentes. |
| `FILE_TOO_LARGE` | 413 | Archivo de más de 5 MiB. |
| `FILE_INVALID_FIELD` | 400 | Campo de archivo incorrecto o segundo archivo. |
| `FILE_INVALID_DOCUMENT_TYPE` | 400 | Tipo documental ausente, inválido o incompatible. |
| `FILE_INVALID_ENTITY_ID` | 400 | ID de entidad mal formado. |
| `FILE_ENTITY_NOT_FOUND` | 404 | No existe el usuario o pedido indicado. |
| `FILE_INVALID_REQUEST` | 400 | Formato de carga incorrecto, campos desconocidos o repetidos, o límites de campos/partes excedidos. |
| `FILE_STORAGE_FAILED` | 500 | No se pudo almacenar el archivo. |
| `FILE_METADATA_PERSISTENCE_FAILED` | 500 | No se pudieron guardar los metadatos. |
| `FILE_INVALID_ID` | 400 | El identificador de los metadatos del archivo no es un ObjectId válido. |
| `FILE_NOT_FOUND` | 404 | No existen los metadatos o el contenido físico del archivo. |

El ejemplo anterior corresponde a HTTP 400 al enviar un producto con `price`
inválido. Estos son otros cuerpos completos que devuelve la API.

| Caso | HTTP | JSON |
| --- | --- | --- |
| Correo duplicado | 409 | `{"success":false,"error":{"code":"USER_EMAIL_ALREADY_EXISTS","message":"Ya existe un usuario con ese correo electrónico."}}` |
| Cantidad inválida en mocks | 400 | `{"success":false,"error":{"code":"MOCK_INVALID_QTY","message":"Revisá el rango de qty para esta operación."}}` |
| Seed con relaciones inválidas | 400 | `{"success":false,"error":{"code":"MOCK_INVALID_SEED_RELATIONS","message":"El lote no cumple las dependencias entre entidades."}}` |
| MongoDB no disponible para el seed | 503 | `{"success":false,"error":{"code":"MOCK_SEED_UNAVAILABLE","message":"El seed requiere una conexión MongoDB con soporte para transacciones."}}` |
| Ruta inexistente | 404 | `{"success":false,"error":{"code":"ROUTE_NOT_FOUND","message":"La ruta solicitada no existe."}}` |
| Fallo inesperado | 500 | `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Error interno del servidor."}}` |
| Cuerpo JSON mayor a 100 KB | 413 | `{"success":false,"error":{"code":"PAYLOAD_TOO_LARGE","message":"El cuerpo de la solicitud supera el tamaño permitido."}}` |

### Probar los errores

Con el servidor en ejecución, ajustá el puerto si corresponde. Para el 409,
usá un correo ya registrado en tu base de prueba. Para el 503, ejecutá el comando
indicado contra una instancia de ShipNow que esté escuchando con MongoDB desconectado.
El caso 500 usa una prueba automatizada que simula un fallo de persistencia.

**PowerShell**

```powershell
$base = 'http://localhost:3000'
$email = 'ana@example.com' # Reemplazalo por un correo existente en tu base de prueba
'{"name":"Caja","price":"invalido"}' | curl.exe -i "$base/api/products" -H 'Content-Type: application/json' --data-binary '@-'
@{ name = 'Ana'; email = $email } | ConvertTo-Json -Compress | curl.exe -i "$base/api/users" -H 'Content-Type: application/json' --data-binary '@-'
curl.exe -i "$base/api/mocks/users?qty=-1"
'{"orders":1}' | curl.exe -i "$base/api/mocks/seed" -H 'Content-Type: application/json' --data-binary '@-'
curl.exe -i -X POST "$base/api/mocks/seed?qty=1" # Ejecutar con MongoDB desconectado
curl.exe -i "$base/api/no-existe"
node --import ./test-support/setup.js --test --test-name-pattern 'Products propaga errores de escritura' test/*.test.js
```

**Linux/macOS**

```sh
base='http://localhost:3000'
curl -i "$base/api/products" -H 'Content-Type: application/json' --data '{"name":"Caja","price":"invalido"}'
# Reemplazá ana@example.com por un correo existente en tu base de prueba
curl -i "$base/api/users" -H 'Content-Type: application/json' --data '{"name":"Ana","email":"ana@example.com"}'
curl -i "$base/api/mocks/users?qty=-1"
curl -i "$base/api/mocks/seed" -H 'Content-Type: application/json' --data '{"orders":1}'
curl -i -X POST "$base/api/mocks/seed?qty=1" # Ejecutar con MongoDB desconectado
curl -i "$base/api/no-existe"
node --import ./test-support/setup.js --test --test-name-pattern 'Products propaga errores de escritura' test/*.test.js
```

## Logging y monitoreo básico

ShipNow usa `winston` y `winston-daily-rotate-file`. La instancia compartida está
en `src/config/logger.js`, consume `config.nodeEnv` de `src/config/index.js` y se
importa en servidor, middlewares, services y controller de demostración.
`createAppLogger` permite crear instancias aisladas para pruebas.

| Nivel | Prioridad | Propósito |
| --- | --- | --- |
| `fatal` | 0 | Fallo del servidor HTTP que impide escuchar. El endpoint de demostración también emite un evento identificado como prueba. |
| `error` | 1 | Error inesperado o fallo de conexión inicial a MongoDB mientras el servidor sigue disponible parcialmente. |
| `warning` | 2 | Error conocido de validación, conflicto, ruta inexistente o indisponibilidad temporal del seed. |
| `info` | 3 | Arranque, conexión establecida, creación de producto o usuario e inicio y confirmación del seed. |
| `http` | 4 | Resumen de una solicitud completada. |
| `debug` | 5 | Cantidades de resultados de listados y generación de vistas previas. |

Un número menor representa mayor severidad. `LOG_LEVELS` está congelado mediante
`Object.freeze` y define exactamente estos seis niveles, incluido `warning`.

| Entorno | Consola | Archivos |
| --- | --- | --- |
| `development` | Seis niveles, timestamp, nivel y mensaje legibles, con colores. | `error` y `fatal` en JSON. |
| `production` | Desde `http` hasta `fatal`, en JSON. Se excluye `debug`. | `error` y `fatal` en JSON. |
| `test` | Instancia predeterminada silenciosa. | Sin transporte de archivos por defecto. Las pruebas usan carpetas temporales y transportes aislados. |

### Archivos, rotación y protección de datos

Los archivos se guardan en `logs/errors-%DATE%.log`, dentro de la raíz del
proyecto. Cada línea contiene JSON válido con `timestamp`, `level` y `message`.

```json
{"timestamp":"2026-11-13T12:00:00.000Z","level":"error","message":"MONGODB_CONNECTION_FAILED"}
```

El transporte tiene `datePattern: 'YYYY-MM-DD'`, `maxSize: '10m'` (10 MB) y
`maxFiles: '14d'` (14 días). Rota automáticamente al cambiar el día o superar el
tamaño. El cambio se comprueba al escribir un evento, por lo que el archivo puede
superar el umbral en el tamaño de un registro. Durante la rotación se aplica la
retención mediante el archivo de auditoría que mantiene el transporte.
El mecanismo trabaja con los archivos generados, sin intervención manual.

El umbral `error` y un filtro explícito admiten exclusivamente `error` y `fatal`
en archivos. `debug`, `http`, `info` y `warning` quedan fuera, aunque aparezcan en
consola según el entorno. `.gitignore` excluye toda la carpeta `logs/`, incluidos
archivos rotados y archivos de auditoría.

La aplicación usa mensajes fijos y cantidades controladas. El formato descarta
metadatos, documentos, cuerpos y objetos Error, y sanitiza patrones reconocibles
de URI, correos y credenciales. Los puntos de logging deben seguir enviando
únicamente mensajes controlados, pues la sanitización no identifica cualquier
secreto arbitrario dentro de texto libre. Ante fallos de transporte se emite una
advertencia fija a stderr una sola vez por instancia, fuera de Winston para
evitar recursión.

### Eventos de la aplicación

| Origen | Evento y nivel |
| --- | --- |
| Arranque | `SERVER_LISTENING` en `info`. |
| MongoDB | `MONGODB_CONNECTED` en `info` o `MONGODB_CONNECTION_FAILED` en `error`. |
| Servidor HTTP | `SERVER_LISTEN_FAILED` en `fatal`, con código de salida 1. |
| Middleware global | `HTTP_ERROR code=... status=...` en `error` para HTTP 500, incluidos los fallos conocidos de archivos; `warning` para los demás errores actuales, incluido 503 del seed. |
| Solicitudes | Un `HTTP_REQUEST method=... route=... status=... durationMs=...` en `http` al finalizar la respuesta. |
| Products | `PRODUCT_CREATED` en `info`, `PRODUCTS_LISTED count=...` en `debug`. |
| Users | `USER_CREATED` en `info`, `USERS_LISTED count=...` en `debug`. |
| GET de mocks | `MOCK_PREVIEW entity=... qty=...` en `debug`, una vez por vista previa solicitada. |
| Seed | `MOCK_SEED_STARTED users=... couriers=... orders=... deliveries=...` en `info`, tras validar las cantidades. |
| Seed confirmado | `MOCK_SEED_COMPLETED users=... couriers=... orders=... deliveries=...` en `info`, después del commit. |
| Archivos asociados | `FILE_UPLOAD_COMPLETED entity=... documentType=... size=...` en `info`, después de confirmar los metadatos. |
| Consulta de archivos | `FILES_LISTED entity=... count=...` en `debug`. |
| Fallo de limpieza | `FILE_CLEANUP_FAILED` en `error`, sin rutas ni mensajes internos. |

Los services de Products, Users y mocks registran los éxitos descritos en la tabla.
Orders utiliza el resumen HTTP y el middleware global, sin eventos de negocio propios.
El middleware global registra la clasificación de
los errores y mantiene el formato HTTP del Módulo 3, con `success: false` y
`error.code`/`error.message`. Una operación fallida no anuncia éxito.
El evento del seed confirmado se emite fuera del callback transaccional para
evitar duplicaciones durante reintentos. La disponibilidad del seed sigue
requiriendo MongoDB con soporte transaccional.

Los resúmenes HTTP contienen únicamente método, plantilla de ruta, status y
duración. Para rutas inexistentes o solicitudes rechazadas por el parser antes
de resolver una ruta, usan `UNMATCHED_ROUTE`. Se conservan etiquetas estáticas de
los prefijos conocidos. Al agregar nuevos routers debe revisarse esa lista.
El resumen HTTP y la clasificación de error son eventos diferentes, uno por
solicitud completada y otro por error, respectivamente.

### Demostración de los seis niveles

`GET /api/logger-test` se registra solamente en `development`. Devuelve HTTP 200
con el siguiente cuerpo y emite `LOGGER_DEMO_DEBUG`, `LOGGER_DEMO_HTTP`,
`LOGGER_DEMO_INFO`, `LOGGER_DEMO_WARNING`, `LOGGER_DEMO_ERROR` y `LOGGER_DEMO_FATAL`.
El fatal de demostración permite que el servidor siga atendiendo solicitudes.
Los eventos de demostración `error` y `fatal` se guardan en los archivos rotativos.
Además se registra el resumen HTTP normal de la solicitud.

```json
{"status":"ok"}
```

En `production` y `test`, la ruta responde HTTP 404 mediante el middleware global.

```json
{"success":false,"error":{"code":"ROUTE_NOT_FOUND","message":"La ruta solicitada no existe."}}
```

Para probar desde PowerShell, iniciá el servidor en una terminal y ejecutá las
solicitudes en otra. Ajustá el puerto si corresponde. La variable de entorno
del proceso tiene precedencia sobre `.env`.

```powershell
# Terminal del servidor
$env:NODE_ENV = 'development'
npm start
# Otra terminal
curl.exe -i 'http://localhost:3000/api/logger-test'
curl.exe -i 'http://localhost:3000/health'
```

En Linux/macOS se puede seleccionar el entorno para el proceso con este comando.

```sh
# Terminal del servidor
NODE_ENV=development npm start
# Otra terminal
curl -i 'http://localhost:3000/api/logger-test'
curl -i 'http://localhost:3000/health'
```

Para verificar el 404 de producción, detené el proceso y repetí el arranque usando
`production` en lugar de `development`. Lo mismo aplica a `test`, donde el logger
predeterminado será silencioso.

### Verificar niveles persistidos y ejecutar pruebas

Después de una llamada de demostración en desarrollo, los siguientes comandos
leen todos los archivos de errores, incluidos los rotados por tamaño. Los campos
de cada línea deben ser `timestamp`, `level` y `message`.

```powershell
$records = @(Get-ChildItem './logs/errors-*.log*' | Get-Content | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
$records | Group-Object level | Select-Object Name, Count
if (@($records | Where-Object { $_.level -notin @('error', 'fatal') }).Count -gt 0) { throw 'Nivel inesperado en archivos de errores' }
npm test
```

En Linux/macOS se usa Node.js para leer el JSON, sin herramientas adicionales.

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
const files = fs.readdirSync('logs').filter(name => /^errors-.*\.log(?:\.\d+)?$/.test(name));
const records = files.flatMap(name => fs.readFileSync('logs/' + name, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
if (records.some(record => !['error', 'fatal'].includes(record.level))) throw new Error('Nivel inesperado');
console.log(records.map(({ level, message }) => ({ level, message })));
JS
npm test
```

`npm test` carga `test-support/setup.js` antes de importar la aplicación y fija
un entorno de prueba aislado. Usá ese script también al seleccionar pruebas con
`node --import ./test-support/setup.js --test --test-name-pattern 'logger' test/*.test.js`.
Para Mocha se usa `npm run test:functional -- --grep 'Logger'`. La suite comprueba la ausencia de
archivos nuevos en la carpeta real `logs/` y cierra los transportes de pruebas.

Las pruebas de persistencia escriben JSON real en carpetas temporales. Las de
rotación generan más de 10 MB y simulan el reloj para verificar cambios de fecha
y la eliminación de archivos con más de 14 días, usando el transporte real.
Las carpetas temporales se eliminan al finalizar. Las pruebas HTTP simulan
MongoDB y el transporte del endpoint de demostración para cubrir los tres
entornos sin escribir archivos en el repositorio.

## Módulo 5 · Documentación interactiva con Swagger/OpenAPI

OpenAPI describe los contratos HTTP de ShipNow como datos estructurados.
Swagger UI presenta esa descripción de forma interactiva para consultar schemas,
parámetros, cuerpos y respuestas, y enviar solicitudes a la API desde el navegador.
Se utiliza OpenAPI **3.0.3** con `swagger-ui-express`.

La configuración está en `src/config/swagger.js`, que obtiene la versión de
`package.json` y el puerto de `config.port`. Los schemas y respuestas reutilizables
se encuentran en `src/docs/schemas.js` y `src/docs/responses.js`. Las operaciones
están separadas en `src/docs/paths/products.js`, `users.js`, `orders.js`, `files.js`, `health.js`, `mocks.js`
y `logger.js`.

### Iniciar y abrir la documentación

Seguí la sección [Ejecutar](#ejecutar) para configurar las tres variables
obligatorias. Desde la raíz del proyecto, los siguientes comandos funcionan
tanto en PowerShell como en Linux/macOS.

```sh
npm install
npm start
```

Para trabajar con reinicio automático se puede usar `npm run dev` en lugar de
`npm start`. Abrí [http://localhost:3000/api/docs](http://localhost:3000/api/docs).
La interfaz puede redirigir a `/api/docs/` para servir sus recursos relativos.
Si `PORT` tiene otro valor, usá ese puerto también en la URL. El selector de
servidor de Swagger refleja el puerto configurado.

La documentación funciona en `development`, `test` y `production`. Con una
configuración de entorno válida, la interfaz y sus recursos se sirven aunque
MongoDB esté desconectado. Products, Users, Orders y el seed siguen requiriendo MongoDB
para las operaciones de persistencia.

Comprobación desde PowerShell, con el servidor en otra terminal.

```powershell
$base = 'http://localhost:3000'
curl.exe -i -L "$base/api/docs"
curl.exe -i "$base/health"
curl.exe -i "$base/api/mocks/deliveries?qty=1"
```

Comprobación equivalente desde Linux/macOS.

```sh
base='http://localhost:3000'
curl -i -L "$base/api/docs"
curl -i "$base/health"
curl -i "$base/api/mocks/deliveries?qty=1"
```

### Alcance documentado

La especificación contiene **19 operaciones** y **24 schemas reutilizables**.

| Tag | Operaciones o representación |
| --- | --- |
| Products | GET y POST `/api/products`. |
| Users | GET y POST `/api/users`, GET y POST `/api/users/{id}/documents`, y vistas previas de usuarios y repartidores con el tag Mocks. |
| Orders | GET y POST `/api/orders`, GET `/api/orders/{id}`, GET y POST `/api/orders/{id}/receipts` y GET `/api/mocks/orders`, junto con Mocks. También participa en el seed. |
| Deliveries | Schema de entrega y GET `/api/mocks/deliveries`, junto con Mocks. También participa en los lotes del seed. |
| Mocks | Cuatro GET de vistas previas y POST `/api/mocks/seed`. |
| Logger | GET `/api/logger-test`, herramienta de validación disponible solo en desarrollo. |
| Health | GET `/health`. |
| Users y Orders | GET `/api/files/{fileId}/download` recupera contenido asociado mediante su ID de metadatos. |

Orders incluye creación y consultas propias; OpenAPI representa `:id` como `{id}`.
Deliveries se documenta mediante su modelo, mocks y seed, sin rutas CRUD propias.
El modelo actual tampoco incluye ítems de pedido, precios por línea, totales o
relaciones entre Order y Product. Esos conceptos quedan fuera de los schemas.
La API no tiene autenticación y la especificación no declara respuestas 401/403.

Los schemas distinguen entradas, documentos persistidos y objetos simulados.
Los documentos pueden incluir `__v` de Mongoose; los objetos mock omiten ese campo.
`ProductCreate.status` conserva la alternativa String/Boolean temporal mediante
`oneOf`, mientras que las respuestas de Products usan estados String.

### Consultar y probar desde Swagger UI

1. Expandí un tag y elegí una operación para ver sus parámetros, schemas y ejemplos.
2. Revisá las respuestas exitosas y las variantes de error antes de usar **Try it out**.
3. Completá los parámetros o el body aplicables y pulsá **Execute** para enviar la
   solicitud al servidor seleccionado. Este paso sí ejecuta la operación real.
4. Consultá el status HTTP y el JSON recibido en **Server response**.

Los cuatro GET de mocks generan lotes en memoria, sin guardar documentos. `qty`
es opcional, vale 10 por defecto y admite de 0 a 100. Los pedidos y entregas
incluyen las entidades relacionadas en la misma respuesta, con referencias
coherentes dentro de ese lote. Cada llamada crea una vista previa independiente.

**POST `/api/mocks/seed` INSERTA documentos reales en la base configurada.** La
interfaz no lo ejecuta al abrir la página. Usá una base de prueba al elegir
**Execute** para esa operación y verificá previamente el servidor seleccionado.

El seed admite dos formatos alternativos.

| Formato | Uso y límite |
| --- | --- |
| Query `?qty=10` | Crea 10 usuarios, 10 repartidores, 10 pedidos y 10 entregas. Rango de 1 a 25, con un total máximo de 100 documentos. Sin default. |
| Body JSON con cantidades | Por ejemplo `{"users":2,"couriers":2,"orders":3,"deliveries":3}`. Enteros no negativos, total entre 1 y 100. Campos omitidos equivalen a cero. |

El body rechaza campos desconocidos. Combinar `qty` con cantidades en un body
no vacío devuelve 400; `qty` junto con `{}` sí está permitido. En Swagger, elegí
el ejemplo `queryMode` con `{}` al usar `qty`, o quitá `qty` para utilizar el
ejemplo `explicitCounts`. Si se omiten ambos formatos, el lote se rechaza.

Los pedidos requieren al menos un usuario. Las entregas requieren repartidores
y un pedido diferente por entrega. El seed asigna las referencias a documentos
del mismo lote y usa una transacción de MongoDB, por lo que necesita Atlas o un
replica set compatible. La respuesta 201 incluye `batchId`, `counts` e `ids` tras
el commit. Las relaciones, la exclusión entre query y body y la suma total se
describen en OpenAPI y se validan en el service.

`/api/logger-test` permanece visible en Swagger en los tres entornos. En
`development` responde 200 y emite seis eventos de demostración. En `test` y
`production` responde 404 `ROUTE_NOT_FOUND`. Su evento fatal permite continuar
atendiendo solicitudes.

### Errores y verificación de consistencia

Swagger reutiliza el formato centralizado del Módulo 3. El status viaja en la
respuesta HTTP y el JSON contiene el código y mensaje públicos, por ejemplo
este HTTP 400 de mocks.

```json
{
  "success": false,
  "error": {
    "code": "MOCK_INVALID_QTY",
    "message": "Revisá el rango de qty para esta operación."
  }
}
```

Las validaciones de Products, Users y Orders pueden incluir `error.details.fields` con
nombres de campos permitidos. Los ejemplos se construyen a partir del catálogo
de 32 códigos. Si varios códigos usan el mismo status, aparecen como ejemplos
de una única respuesta OpenAPI, sin sobrescribirse.

Ejecutá la regresión con estos comandos, válidos en ambos sistemas.

```sh
npm test
node --import ./test-support/setup.js --test --test-name-pattern 'OpenAPI|schemas|documentado|Swagger|Orders' test/*.test.js
```

Las pruebas comparan métodos de los routers con los paths documentados, verifican
tags, enums, defaults, campos, referencias `$ref`, ejemplos, variantes de error
y respuestas HTTP con persistencia simulada. También comprueban HTML, CSS y
scripts de Swagger UI con MongoDB desconectado y la restricción del logger por
entorno. Importar o cargar la documentación no ejecuta automáticamente el seed.

La revisión manual coteja los prefijos de montaje en `app.js`, las descripciones
y las reglas entre campos con controllers, services y repository. Las pruebas de
schemas verifican las restricciones utilizadas por ShipNow; no reemplazan un
validador general de toda la especificación OpenAPI. Las pruebas de documentación
no envían solicitudes de seed y la suite existente usa MongoDB simulado, sin Atlas
ni archivos nuevos en la carpeta real `logs/`.

## Módulo 6 · Testing funcional

Los conteos de esta sección describen el cierre del Módulo 6. La sección del
Módulo 7 detalla la ampliación de cobertura y el resultado actual.

La suite nueva usa **Mocha**, **Chai** y **Supertest**, instalados como
`devDependencies`. Mocha ejecuta y organiza las pruebas, Chai verifica resultados
y Supertest envía solicitudes HTTP a la aplicación exportada por `src/app.js`.
No hay que ejecutar `npm start` ni disponer de MongoDB para correr las suites.
Instalá también las dependencias de desarrollo: desde un checkout con lockfile,
`npm ci` prepara el entorno en PowerShell y Linux/macOS. No usar `--omit=dev`
para ejecutar estas pruebas.

### Suites, estructura y comandos

| Ubicación | Ejecutor y alcance |
| --- | --- |
| `test/` | 140 pruebas de regresión con `node:test` y `node:assert/strict`: configuración, modelos, dominio, logging, errores, HTTP y contratos OpenAPI. |
| `tests/` | 134 pruebas funcionales con Mocha, Chai y Supertest: `health/`, `products/`, `users/`, `orders/`, `mocks/`, `logger/`, `swagger/` y `errors/`. |
| `tests/support/` | Helpers de expectativas, reemplazos, invariantes del dominio y barreras de aislamiento. |
| `test-support/setup.js` | Preparación del entorno antes de importar la aplicación en ambas suites. |
| `.mocharc.json` | Carga la preparación y los hooks globales; descubre únicamente `tests/**/*.test.js`. |

La separación es de ejecutores y organización: la regresión también contiene
pruebas HTTP, mientras que la suite nueva utiliza Supertest de forma sistemática.
No representa una medición porcentual de cobertura de líneas o ramas.

Estos comandos funcionan desde la raíz en ambos sistemas operativos:

```sh
npm run test:regression
npm run test:functional
npm test
npm test
```

`npm test` ejecuta primero la regresión y, si pasa, la suite funcional, en procesos
separados. Node descubre exclusivamente `test/*.test.js` y Mocha exclusivamente
`tests/**/*.test.js`: no ejecutan los mismos archivos dos veces. Las dos llamadas
completas deben terminar sin limpieza manual. El resultado de referencia del
Módulo 6 es **274 pruebas aprobadas: 140 de regresión y 134 funcionales**.

Para seleccionar casos de Mocha, por ejemplo Orders:

```sh
npm run test:functional -- --grep 'Orders por HTTP'
```

### Cobertura funcional y contratos

| Recurso | Pruebas | Casos principales |
| --- | ---: | --- |
| Health | 1 | HTTP 200, JSON y body exacto. |
| Products | 11 | GET/POST, defaults, campos, precio/stock/estado inválidos y fallos de lectura. |
| Users | 10 | GET/POST, normalización, validaciones, duplicados previos y al guardar, fallos internos. |
| Orders | 38 | Listado con datos y vacío, creación mínima/completa, defaults, referencias, rol USER, ID inválido, 404 y errores de persistencia. |
| GET de mocks | 40 | Las cuatro rutas, qty predeterminado/válido/0/100, cantidades inválidas, roles, enums y relaciones. |
| Seed | 22 | HTTP 201 con qty o body, relaciones, IDs devueltos, validaciones, 503 y rollback simulado. |
| Logger | 3 | Ruta disponible en development y ausente en test/production. |
| Swagger UI | 5 | HTML y recursos servidos sin MongoDB. |
| Errores globales | 4 | 400 JSON inválido, 404, 413 y 500 sin datos internos. |

Las respuestas de error se comparan con el catálogo real, incluyendo
`details.fields` solo cuando corresponde. Para Orders se comprueba que un ID
inválido no consulte persistencia y que entradas rechazadas no inserten documentos.
JSON `null` es rechazado por el parser estricto de Express con `INVALID_JSON` antes
de llegar al service. Las comprobaciones documentales de regresión verifican las
las operaciones, schemas, enums, defaults, referencias `$ref`, ejemplos y respuestas
HTTP con persistencia simulada.

No se prueba actualización de estados: no existe PATCH y el dominio no define
transiciones ni sincronización con Delivery. Tampoco se afirma cobertura de CRUD
de Deliveries, autenticación, ítems o totales de pedidos.

### Entorno, persistencia simulada y limpieza

`test-support/setup.js` fija `NODE_ENV=test`, `PORT=3000` y una URI local ficticia
para una base llamada `shipnow_test_unused` antes de importar módulos dependientes
del entorno. Esa URI **no se utiliza para conectar ni requiere una base existente**.
No se usa la conexión principal ni se modifica `.env`. La configuración productiva
sigue centralizada en `src/config/index.js`; dotenv respeta los valores preparados
para el proceso de prueba. El logger predeterminado permanece silencioso en test.

Las pruebas atraviesan Express, routers, controllers, services y repositories.
Se reemplazan las operaciones necesarias de los modelos Mongoose, conservando
las validaciones reales del esquema cuando corresponde. No se depende de registros
persistidos. Las fixtures controladas se crean por prueba; los mocks aleatorios
se verifican mediante invariantes, tipos y relaciones, sin exigir IDs o correos
aleatorios exactos.

Los hooks `beforeEach` instalan reemplazos y preparan estado nuevo; `afterEach`
los restaura. La barrera global de `tests/support/isolation.js` impide conexiones
por `mongoose.connect`/`openUri`, transacciones sin simular y operaciones de escritura
de las colecciones. Al finalizar exige cero intentos prohibidos, conexión cerrada
y ningún archivo nuevo en `logs/`. La URI ficticia por sí sola no es la barrera.
Los reemplazos se restauran también cuando una aserción falla.

Supertest administra servidores temporales; no se importa `server.js` para iniciar
el servidor productivo en la suite funcional. El logger se prueba por entorno en
procesos separados, con transportes simulados y recursos liberados. La regresión
prueba archivos de logging reales únicamente en carpetas temporales que elimina
al finalizar. La suite de Users no depende del número de inicializaciones del
índice de email, cuya promesa se cachea; los escenarios anteriores de regresión
mantienen el aislamiento de procesos de Node.

El seed se prueba por HTTP, pero sus inserciones, sesión y transacción se simulan
en memoria. Se verifica la coordinación y el rollback del doble, **no la persistencia
real ni la atomicidad de una transacción MongoDB real**. Las suites no ejecutan un
seed real ni necesitan Atlas. Una prueba de integración con MongoDB requeriría
otra etapa y una base aislada con soporte transaccional, nunca la base principal.

`.gitignore` mantiene excluidos `.env`, `node_modules/` y `logs/`. Antes de entregar,
revisá los cambios con `git status --short`, ejecutá ambas suites y repetí `npm test`.
El repositorio debe incluir los archivos nuevos de Orders, pruebas y OpenAPI al
registrar manualmente los cambios; los comandos de testing no hacen commits ni pushes.

## Módulo 7 · Documentos y comprobantes

ShipNow permite asociar documentos a usuarios y comprobantes a pedidos mediante
Multer 2.5.0. La configuración está centralizada en `src/config/multer.js`;
`files.routes.js`, `file.controller.js`, `file.service.js` y `file.repository.js`
mantienen las capas existentes. Los bytes se guardan en disco y únicamente los
metadatos en la colección independiente del modelo `UploadedFile`. Los modelos
User, Order y Delivery conservan sus contratos. No se modifican estados.

| Método y ruta | Entrada y respuesta |
| --- | --- |
| POST `/api/users/:id/documents` | Multipart con `file` y `documentType`; HTTP 201 con metadatos. |
| GET `/api/users/:id/documents` | HTTP 200 con array de metadatos de ese usuario. |
| POST `/api/orders/:id/receipts` | Multipart con `file` y `documentType`; HTTP 201 con metadatos. |
| GET `/api/orders/:id/receipts` | HTTP 200 con array de metadatos de ese pedido. |
| GET `/api/files/:fileId/download` | HTTP 200 con el contenido binario del archivo asociado. |

El parámetro `id` debe ser un ObjectId hexadecimal de 24 caracteres de una entidad
existente. Se comprueba antes de iniciar la escritura. Un ID inválido devuelve 400
`FILE_INVALID_ENTITY_ID`; una entidad inexistente, 404 `FILE_ENTITY_NOT_FOUND`.
Una entidad existente sin archivos devuelve 200 y `[]`. Las referencias se derivan
de la ruta: no se aceptan `ownerModel` ni `ownerId` en el body.

### Multipart y límites

| Campo | Reglas |
| --- | --- |
| `file` | Obligatorio, exactamente un archivo. PDF, JPEG o PNG; extensiones .pdf, .jpg, .jpeg o .png. |
| `documentType` para User | Obligatorio: `identity` o `address_proof`. |
| `documentType` para Order | Obligatorio: `delivery_proof`. |

Máximo **5 MiB (5 242 880 bytes)** por archivo, un campo de texto y dos partes
multipart. El archivo y el texto pueden enviarse en cualquier orden. Se rechazan
campos adicionales o repetidos. MIME, extensión y firma básica deben coincidir;
la firma básica no es un antivirus ni una validación completa del documento.
No configurar manualmente el boundary: `curl.exe` y Swagger lo generan.

`DOCUMENT_TYPES`, `FILE_MIME_TYPES`, `FILE_OWNERS` y `UPLOAD_POLICY` centralizan las
políticas mediante `Object.freeze`. Los errores públicos se detallan en la tabla
general: archivo faltante (400 `FILE_REQUIRED`), tipo incorrecto (415
`FILE_INVALID_TYPE`), tamaño excedido (413 `FILE_TOO_LARGE`), campo incorrecto o
segundo archivo (400 `FILE_INVALID_FIELD`), tipo documental incorrecto (400
`FILE_INVALID_DOCUMENT_TYPE`) y formato/campos inválidos (400 `FILE_INVALID_REQUEST`).
Los fallos de disco y metadatos usan `FILE_STORAGE_FAILED` y
`FILE_METADATA_PERSISTENCE_FAILED`, ambos 500; otros fallos inesperados conservan
`INTERNAL_ERROR`. Si se envía JSON, los errores globales del parser siguen aplicando.
Los errores de archivos no incluyen `details` ni mensajes internos.

### Ejemplos desde PowerShell

Iniciá el servidor según [Ejecutar](#ejecutar), con una base de prueba conectada.
Usá entidades existentes. Los siguientes comandos obtienen sus IDs reales; no
crean usuarios ni pedidos. Si no existen, preparalos con los endpoints respectivos.
**Los POST siguientes sí escriben archivos en disco y metadatos en MongoDB.**

```powershell
$base = 'http://localhost:3000'
$usuarios = @(Invoke-RestMethod -Uri "$base/api/users")
$pedidos = @(Invoke-RestMethod -Uri "$base/api/orders")
if ($usuarios.Count -eq 0 -or $pedidos.Count -eq 0) { throw 'Se necesitan un usuario y un pedido existentes en la base de prueba' }
$userId = $usuarios[0]._id
$orderId = $pedidos[0]._id
# Reemplazar por archivos PDF reales de prueba del equipo.
$documento = (Resolve-Path './documento.pdf').Path
$comprobante = (Resolve-Path './comprobante.pdf').Path
curl.exe -i -X POST "$base/api/users/$userId/documents" -F "file=@$documento;type=application/pdf" -F 'documentType=identity'
curl.exe -i -X POST "$base/api/orders/$orderId/receipts" -F "file=@$comprobante;type=application/pdf" -F 'documentType=delivery_proof'
curl.exe -i "$base/api/users/$userId/documents"
curl.exe -i "$base/api/orders/$orderId/receipts"
```

En Linux/macOS, utilizá `curl`, las rutas de archivos de tu equipo y variables
`userId`/`orderId` obtenidas de tus GET reales. También se pueden usar Postman o
Swagger: seleccionar multipart y adjuntar el archivo en `file`.

Ejemplo ilustrativo de HTTP 201; estos IDs no representan entidades disponibles
en tu base y no deben copiarse como entradas reales:

```json
{
  "_id": "507f1f77bcf86cd799439051",
  "ownerModel": "User",
  "ownerId": "507f1f77bcf86cd799439011",
  "originalName": "documento.pdf",
  "filename": "5de0805a-f569-4ee2-a2b5-ea567c767991.pdf",
  "path": "users/documents/5de0805a-f569-4ee2-a2b5-ea567c767991.pdf",
  "mimeType": "application/pdf",
  "size": 1234,
  "documentType": "identity",
  "uploadedAt": "2026-11-16T15:00:00.000Z",
  "__v": 0
}
```

El GET devuelve un array de esos objetos, sin orden garantizado. Filtra por
`ownerModel` y `ownerId` y no devuelve archivos de otras entidades. Los comprobantes
de pedido usan `ownerModel: "Order"` y `documentType: "delivery_proof"`.

### Almacenamiento, compensación y límites del alcance

Las carpetas se preparan bajo demanda, no al importar Express:

```text
uploads/
  staging/
  users/documents/
  orders/receipts/
```

El nombre definitivo es un UUID generado por el servidor con extensión canónica.
El nombre original normalizado solo se guarda como metadato. `path` es relativo a
la raíz de almacenamiento: **no es una URL pública ni una ruta absoluta**.
La carpeta no se sirve mediante `express.static` y `/uploads/` está excluida de Git.
Los GET de documentos/comprobantes recuperan solo metadatos. El contenido se
recupera mediante la descarga controlada por `_id`, descrita a continuación.

El modelo registra `ownerModel`, `ownerId` con `refPath`, `originalName`, `filename`,
`path`, `mimeType`, `size`, `documentType` y `uploadedAt`, además de `_id`/`__v` de
Mongoose. Usa un índice compuesto por propietario. Nunca guarda el binario en MongoDB.

Tras validar la entidad se recibe el temporal, se valida y mueve el archivo y se
guardan sus metadatos. Ante validaciones fallidas se elimina staging; ante fallo de
persistencia se intenta eliminar el definitivo. Una asociación ya confirmada no
se elimina si luego falla la respuesta HTTP. Un fallo de limpieza se registra como
`FILE_CLEANUP_FAILED` sin rutas internas. **No existe atomicidad entre MongoDB y
disco**: una caída del proceso o resultado ambiguo de persistencia puede necesitar
reconciliación manual. La raíz debe ser controlada por la aplicación.

La API **no tiene autenticación ni autorización**. Validar que la entidad exista
no comprueba quién puede acceder a sus documentos. Usar datos ficticios en el
entorno académico; no exponer públicamente documentos personales reales.

Winston registra `FILE_UPLOAD_COMPLETED` en info solo tras confirmar la asociación,
`FILES_LISTED` en debug, rechazos mediante el middleware global en warning y fallos
500 en error. No registra nombres originales, contenido, rutas internas ni IDs reales.

### Pruebas y documentación interactiva

Swagger en `/api/docs` documenta las cuatro operaciones con multipart, schemas
`UserDocumentUpload`, `OrderReceiptUpload` y `UploadedFile`, y ejemplos de los diez
errores de carga. También documenta la descarga binaria. El total actual es
**19 operaciones y 24 schemas**.

```sh
npm run test:regression
npm run test:functional
npm test
npm test
```

Las pruebas de uploads están en `tests/uploads/`: 28 de infraestructura y 43 de
endpoints. Usan archivos reales únicamente en carpetas temporales aisladas,
restauradas y eliminadas por hooks; Mongoose se simula. No requieren Atlas ni una
base real y no demuestran persistencia MongoDB real o atomicidad. Las pruebas de
documentación verifican también los contratos y `/api/docs` sin conexión.

Resultado de referencia tras incorporar descarga: **378 aprobadas, 148 de regresión
y 230 funcionales**, sin fallos. Las dos suites se ejecutan por separado dentro de `npm test`.

### Descarga controlada

`GET /api/files/:fileId/download` recupera el contenido binario. `fileId` es el
`_id` de UploadedFile devuelto por un POST o GET de documentos/comprobantes,
no el ID del usuario o pedido. El servidor busca los metadatos, comprueba que la
entidad asociada exista y abre el archivo dentro de la raíz configurada. Rechaza
rutas absolutas, traversal, symlinks/junctions y contenido que no sea archivo regular.
No acepta rutas por query o body y no expone un directorio estático.

Responde con `Content-Disposition: attachment` y nombre UUID generado seguro,
`Content-Type` PDF/JPEG/PNG, tamaño real mediante `Content-Length` y
`X-Content-Type-Options: nosniff`. No revela la ruta absoluta ni usa el nombre
original del cliente para los encabezados. No borra el archivo al descargarlo.

Ejemplo PowerShell, continuando con `$base` y `$userId` obtenidos de entidades
existentes en los ejemplos anteriores:

```powershell
$documentos = @(Invoke-RestMethod -Uri "$base/api/users/$userId/documents")
if ($documentos.Count -eq 0) { throw 'El usuario no tiene archivos asociados' }
$fileId = $documentos[0]._id
# Elegir un destino local; la extensión real puede ser pdf, jpg o png.
$destino = Join-Path (Get-Location) $documentos[0].filename
curl.exe --fail -o "$destino" "$base/api/files/$fileId/download"
```

En Linux/macOS, después de obtener un `fileId` real del GET de metadatos:

```sh
base='http://localhost:3000'
printf 'ID de metadatos obtenido del GET: '
read -r fileId
curl --fail -o archivo-descargado "$base/api/files/$fileId/download"
```

ID inválido devuelve 400 `FILE_INVALID_ID`; ausencia de metadatos o de archivo físico,
404 `FILE_NOT_FOUND`; entidad asociada eliminada, 404 `FILE_ENTITY_NOT_FOUND`.
Una ruta almacenada insegura o un fallo de lectura devuelve 500 `FILE_STORAGE_FAILED`;
fallos inesperados de consulta conservan `INTERNAL_ERROR`. Los errores anteriores
a enviar headers usan el formato JSON centralizado. Si la lectura falla después,
se registra `FILE_DOWNLOAD_STREAM_FAILED` y se corta la respuesta binaria, sin
agregar JSON. La cancelación del cliente cierra el descriptor y conserva el archivo.

La descarga **no incorpora autenticación ni autorización**: conocer un ID permite
solicitar el archivo. No usar documentos personales reales ni exponer esta API
académica como un servicio público. La raíz debe estar controlada por la aplicación;
la descarga no agrega antivirus ni resuelve la falta de atomicidad entre disco y MongoDB.

`tests/uploads/download.test.js` agrega 25 casos con disco temporal y MongoDB simulado:
PDF/JPEG/PNG, bytes exactos, headers, errores, traversal, junctions, aislamiento de
raíces, fallos antes/después de headers y cancelación con cierre de descriptor.
