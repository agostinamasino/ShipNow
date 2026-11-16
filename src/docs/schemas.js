import { PRODUCT_STATUS, USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY, DOCUMENT_TYPES, FILE_MIME_TYPES, FILE_OWNERS, UPLOAD_POLICY } from '../constants/index.js';
import { ERROR_CATALOG } from '../errors/error.catalog.js';

const productProperties = {
  name: { type: 'string', minLength: 1, description: 'Nombre obligatorio. Se recortan los espacios externos.' },
  description: { type: 'string', nullable: true, default: '', description: 'Se recortan los espacios externos.' },
  price: { type: 'number', minimum: 0 },
  stock: { type: 'integer', minimum: 0, default: 0 },
  status: { type: 'string', enum: Object.values(PRODUCT_STATUS), default: PRODUCT_STATUS.AVAILABLE },
};
const userProperties = {
  name: { type: 'string', minLength: 1, description: 'Nombre obligatorio. Se recortan los espacios externos.' },
  email: {
    type: 'string',
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    description: 'Formato básico validado por el modelo. Se recorta y convierte a minúsculas. Debe ser único.',
  },
  role: {
    type: 'string', enum: Object.values(USER_ROLES), default: USER_ROLES.USER,
    description: 'Se recortan espacios externos antes de validar el rol.',
  },
};
const persistedProperties = {
  _id: { $ref: '#/components/schemas/ObjectId' },
  __v: { type: 'integer', readOnly: true, description: 'Versión del documento generada por Mongoose.' },
};
const orderProperties = {
  userId: { $ref: '#/components/schemas/ObjectId' },
  status: { type: 'string', enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING },
  priority: { type: 'string', enum: Object.values(ORDER_PRIORITY), default: ORDER_PRIORITY.NORMAL },
  destinationAddress: { type: 'string', minLength: 1, description: 'Dirección requerida. Se recortan los espacios externos.' },
};
const deliveryProperties = {
  orderId: { $ref: '#/components/schemas/ObjectId' },
  courierId: { $ref: '#/components/schemas/ObjectId' },
  status: { type: 'string', enum: Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.ASSIGNED },
};
const countProperties = Object.fromEntries(['users', 'couriers', 'orders', 'deliveries']
  .map(field => [field, { type: 'integer', minimum: 0, maximum: 100, default: 0 }]));
const idArrays = Object.fromEntries(['users', 'couriers', 'orders', 'deliveries']
  .map(field => [field, { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } }]));

function mockResponse(properties) {
  return {
    type: 'object', required: Object.keys(properties), additionalProperties: false,
    properties: Object.fromEntries(Object.entries(properties).map(([field, schema]) =>
      [field, { type: 'array', items: { $ref: `#/components/schemas/${schema}` } }])),
  };
}

export default {
  UserDocumentUpload: {
    type: 'object', required: ['file', 'documentType'], additionalProperties: false,
    description: 'Un archivo y un campo de texto, en cualquier orden. No se admiten campos desconocidos o repetidos, ownerModel ni ownerId. El servidor valida MIME, extensión y firma básica.',
    properties: {
      file: { type: 'string', format: 'binary', description: `Archivo obligatorio PDF, JPEG o PNG. Máximo ${UPLOAD_POLICY.maxSize} bytes (5 MiB); extensiones .pdf, .jpg, .jpeg o .png coherentes con el contenido.` },
      documentType: { type: 'string', enum: [DOCUMENT_TYPES.IDENTITY, DOCUMENT_TYPES.ADDRESS_PROOF] },
    },
  },
  OrderReceiptUpload: {
    type: 'object', required: ['file', 'documentType'], additionalProperties: false,
    description: 'Un comprobante y un campo de texto, en cualquier orden. No se admiten campos desconocidos o repetidos. No modifica estados ni crea entregas.',
    properties: {
      file: { type: 'string', format: 'binary', description: `Archivo obligatorio PDF, JPEG o PNG. Máximo ${UPLOAD_POLICY.maxSize} bytes (5 MiB); extensiones .pdf, .jpg, .jpeg o .png coherentes con el contenido.` },
      documentType: { type: 'string', enum: [DOCUMENT_TYPES.DELIVERY_PROOF] },
    },
  },
  UploadedFile: {
    type: 'object',
    required: ['_id', 'ownerModel', 'ownerId', 'originalName', 'filename', 'path', 'mimeType', 'size', 'documentType', 'uploadedAt'],
    description: 'Metadatos persistidos, sin bytes del archivo. ownerModel y ownerId se derivan de la ruta. El nombre generado y la ruta relativa son internos al almacenamiento, no una URL pública. Para descargar se usa el _id con GET /api/files/{fileId}/download. El tipo documental debe ser compatible con la entidad.',
    properties: {
      ...persistedProperties,
      ownerModel: { type: 'string', enum: Object.values(FILE_OWNERS) },
      ownerId: { $ref: '#/components/schemas/ObjectId' },
      originalName: { type: 'string', minLength: 1, maxLength: 255, description: 'Nombre original normalizado para metadatos; no se utiliza para construir rutas.' },
      filename: { type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.(pdf|jpg|png)$' },
      path: { type: 'string', pattern: '^(users/documents|orders/receipts)/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.(pdf|jpg|png)$', description: 'Ruta relativa a uploads/. Nunca una ruta absoluta ni un enlace público.' },
      mimeType: { type: 'string', enum: Object.values(FILE_MIME_TYPES) },
      size: { type: 'integer', minimum: 1, maximum: UPLOAD_POLICY.maxSize, description: 'Tamaño real en bytes.' },
      documentType: { type: 'string', enum: Object.values(DOCUMENT_TYPES) },
      uploadedAt: { type: 'string', format: 'date-time', description: 'Fecha generada por el servidor.' },
    },
  },
  ObjectId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '507f1f77bcf86cd799439011' },
  ProductCreate: {
    type: 'object',
    description: 'Formato recomendado de creación. Mongoose también realiza sus conversiones de tipos, como strings numéricos en price y stock. Los campos adicionales son ignorados por el service.',
    required: ['name', 'price'],
    properties: {
      ...productProperties,
      status: {
        default: PRODUCT_STATUS.AVAILABLE,
        description: 'Compatibilidad temporal: true se guarda como available y false como out_of_stock. La respuesta siempre utiliza String.',
        oneOf: [
          { type: 'string', enum: Object.values(PRODUCT_STATUS) },
          { type: 'boolean' },
        ],
      },
    },
  },
  Product: {
    type: 'object',
    required: ['_id', 'name', 'price', 'status'],
    description: 'Documento devuelto por la API. El estado siempre es String, incluso al leer booleanos históricos. __v puede faltar en documentos históricos.',
    properties: { ...persistedProperties, ...productProperties },
  },
  UserCreate: {
    type: 'object',
    required: ['name', 'email'],
    description: 'Formato recomendado. Mongoose aplica conversiones de tipos. Los campos adicionales son ignorados por el service.',
    properties: userProperties,
  },
  User: {
    type: 'object',
    required: ['_id', 'name', 'email', 'role'],
    properties: { ...persistedProperties, ...userProperties },
  },
  ErrorResponse: {
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: Object.keys(ERROR_CATALOG) },
          message: { type: 'string', description: 'Mensaje público controlado por el catálogo.' },
          details: {
            type: 'object',
            description: 'Opcional, solo para PRODUCT_VALIDATION_FAILED, USER_VALIDATION_FAILED y ORDER_VALIDATION_FAILED. Incluye exclusivamente nombres de campos permitidos para la entidad, nunca valores recibidos.',
            required: ['fields'],
            properties: {
              fields: {
                type: 'array',
                items: { type: 'string', enum: ['name', 'description', 'price', 'stock', 'status', 'email', 'role', 'userId', 'destinationAddress', 'priority'] },
              },
            },
          },
        },
      },
    },
  },
  HealthResponse: {
    type: 'object', required: ['status'],
    properties: { status: { type: 'string', enum: ['ok'] } },
  },
  OrderCreate: {
    type: 'object', required: ['userId', 'destinationAddress'],
    description: 'userId debe ser un String hexadecimal de 24 caracteres y referenciar un usuario existente con rol USER (user). La dirección debe ser String y conservar contenido después de trim. status y priority se validan exactamente, sin conversiones; null y strings vacíos se rechazan. Sus defaults se aplican solo al omitirlos. Las propiedades adicionales son ignoradas.',
    properties: {
      ...orderProperties,
      destinationAddress: {
        ...orderProperties.destinationAddress,
        pattern: '\\S',
      },
    },
  },
  Order: {
    type: 'object', required: ['_id', ...Object.keys(orderProperties)],
    description: 'Pedido persistido, creado mediante POST /api/orders o seed. userId se devuelve como ID, sin datos personales del usuario. Puede incluir __v de Mongoose.',
    properties: { ...persistedProperties, ...orderProperties },
  },
  Delivery: {
    type: 'object', required: ['_id', ...Object.keys(deliveryProperties)],
    description: 'Entrega persistida. orderId referencia a Order y courierId a un User repartidor. Se crea mediante el seed.',
    properties: { ...persistedProperties, ...deliveryProperties },
  },
  MockUser: {
    type: 'object', required: ['_id', 'name', 'email', 'role'], additionalProperties: false,
    description: 'Usuario simulado en memoria. Su email es ficticio y único dentro del lote.',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' }, ...userProperties,
      role: { type: 'string', enum: [USER_ROLES.USER] },
    },
  },
  MockCourier: {
    type: 'object', required: ['_id', 'name', 'email', 'role'], additionalProperties: false,
    description: 'Repartidor simulado, representado como User con rol COURIER.',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' }, ...userProperties,
      role: { type: 'string', enum: [USER_ROLES.COURIER] },
    },
  },
  MockOrder: {
    type: 'object', required: ['_id', ...Object.keys(orderProperties)], additionalProperties: false,
    description: 'Pedido simulado. userId coincide con un usuario incluido en la respuesta.',
    properties: { _id: { $ref: '#/components/schemas/ObjectId' }, ...orderProperties },
  },
  MockDelivery: {
    type: 'object', required: ['_id', ...Object.keys(deliveryProperties)], additionalProperties: false,
    description: 'Entrega simulada. orderId y courierId se resuelven en las listas incluidas en la misma respuesta.',
    properties: { _id: { $ref: '#/components/schemas/ObjectId' }, ...deliveryProperties },
  },
  MockUsersResponse: mockResponse({ users: 'MockUser' }),
  MockCouriersResponse: mockResponse({ couriers: 'MockCourier' }),
  MockOrdersResponse: mockResponse({ orders: 'MockOrder', users: 'MockUser' }),
  MockDeliveriesResponse: mockResponse({
    deliveries: 'MockDelivery', orders: 'MockOrder', users: 'MockUser', couriers: 'MockCourier',
  }),
  SeedCounts: {
    type: 'object', required: Object.keys(countProperties), additionalProperties: false,
    description: 'Cantidades normalizadas por entidad. La suma del lote es de 1 a 100.',
    properties: countProperties,
  },
  SeedRequest: {
    type: 'object', additionalProperties: false, properties: countProperties,
    description: 'Cantidades explícitas. Los campos omitidos cuentan como cero. Sin qty, la suma debe estar entre 1 y 100. Los pedidos requieren al menos un usuario; las entregas necesitan repartidores y un pedido distinto por entrega. No se combina qty con un body no vacío. El body {} junto con qty sí está admitido. Las restricciones entre campos se validan en el service.',
  },
  SeedResponse: {
    type: 'object', required: ['batchId', 'counts', 'ids'], additionalProperties: false,
    properties: {
      batchId: { type: 'string', format: 'uuid', description: 'Identificador único del lote creado por esta solicitud.' },
      counts: { $ref: '#/components/schemas/SeedCounts' },
      ids: {
        type: 'object', required: Object.keys(idArrays), additionalProperties: false,
        description: 'IDs insertados en este mismo lote, agrupados por entidad. Cada array tiene la longitud indicada en counts.',
        properties: idArrays,
      },
    },
  },
};
