import { paginationParameters, paginationMedia } from '../pagination.js';
import { PRODUCT_STATUS } from '../../constants/index.js';

const example = {
  _id: '507f1f77bcf86cd799439011', name: 'Caja mediana', description: 'Caja para envíos',
  price: 1500, stock: 20, status: PRODUCT_STATUS.AVAILABLE, __v: 0,
};

export default {
  '/api/products': {
    get: {
      parameters: paginationParameters,
      tags: ['Products'],
      operationId: 'getProducts',
      summary: 'Listar productos',
      description: 'Lee MongoDB. Convierte estados booleanos históricos a String en memoria. Un estado histórico desconocido devuelve INTERNAL_ERROR. Los errores del parser aplican si se envía un cuerpo JSON.',
      responses: {
        200: { description: 'Página ordenada por _id ascendente; data puede estar vacío.', content: { 'application/json': paginationMedia('ProductsPage', example) } },
        400: { $ref: '#/components/responses/ListBadRequest' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
    post: {
      tags: ['Products'],
      operationId: 'createProduct',
      summary: 'Crear un producto',
      requestBody: {
        required: true,
        content: { 'application/json': {
          schema: { $ref: '#/components/schemas/ProductCreate' },
          examples: {
            minimal: { value: { name: 'Caja mediana', price: 1500 } },
            complete: { value: { name: 'Caja mediana', description: 'Caja para envíos', price: 1500, stock: 20, status: PRODUCT_STATUS.AVAILABLE } },
            legacyStatus: { value: { name: 'Caja mediana', price: 1500, status: false } },
          },
        } },
      },
      responses: {
        201: {
          description: 'Producto guardado con estado String.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' }, example } },
        },
        400: { $ref: '#/components/responses/ProductBadRequest' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
