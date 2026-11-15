import { PRODUCT_STATUS, USER_ROLES } from '../constants/index.js';
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

export default {
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
            description: 'Opcional. Solo las validaciones de Products y Users pueden incluir campos permitidos.',
            required: ['fields'],
            properties: {
              fields: {
                type: 'array',
                items: { type: 'string', enum: ['name', 'description', 'price', 'stock', 'status', 'email', 'role'] },
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
};
