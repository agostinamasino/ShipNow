# ShipNow

API académica de Backend 3 con Node.js, Express y MongoDB/Mongoose.
Products, Users y mocks siguen la arquitectura por capas.

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

`src/constants/index.js` exporta cinco objetos inmutables mediante `Object.freeze`.

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
| `MOCK_INVALID_QTY` | 400 | `qty` es inválido, está repetido o queda fuera del rango del endpoint. |
| `MOCK_INVALID_SEED_REQUEST` | 400 | El body o las cantidades del seed son inválidos, o se combinan cantidades del body con `qty`. |
| `MOCK_INVALID_SEED_RELATIONS` | 400 | Faltan usuarios para los pedidos o faltan pedidos distintos o repartidores para las entregas. |
| `MOCK_SEED_UNAVAILABLE` | 503 | MongoDB no está disponible para el seed o rechaza la operación transaccional por falta de soporte. |
| `INTERNAL_ERROR` | 500 | Fallo inesperado. El mensaje público es genérico. |

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
npm test -- --test-name-pattern 'Products propaga errores de escritura'
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
npm test -- --test-name-pattern 'Products propaga errores de escritura'
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
| Middleware global | `HTTP_ERROR code=... status=...` en `warning` para errores conocidos o `error` para `INTERNAL_ERROR`. |
| Solicitudes | Un `HTTP_REQUEST method=... route=... status=... durationMs=...` en `http` al finalizar la respuesta. |
| Products | `PRODUCT_CREATED` en `info`, `PRODUCTS_LISTED count=...` en `debug`. |
| Users | `USER_CREATED` en `info`, `USERS_LISTED count=...` en `debug`. |
| GET de mocks | `MOCK_PREVIEW entity=... qty=...` en `debug`, una vez por vista previa solicitada. |
| Seed | `MOCK_SEED_STARTED users=... couriers=... orders=... deliveries=...` en `info`, tras validar las cantidades. |
| Seed confirmado | `MOCK_SEED_COMPLETED users=... couriers=... orders=... deliveries=...` en `info`, después del commit. |

Los services registran éxitos. El middleware global registra la clasificación de
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
`npm test -- --test-name-pattern 'logger'`. La suite comprueba la ausencia de
archivos nuevos en la carpeta real `logs/` y cierra los transportes de pruebas.

Las pruebas de persistencia escriben JSON real en carpetas temporales. Las de
rotación generan más de 10 MB y simulan el reloj para verificar cambios de fecha
y la eliminación de archivos con más de 14 días, usando el transporte real.
Las carpetas temporales se eliminan al finalizar. Las pruebas HTTP simulan
MongoDB y el transporte del endpoint de demostración para cubrir los tres
entornos sin escribir archivos en el repositorio.
