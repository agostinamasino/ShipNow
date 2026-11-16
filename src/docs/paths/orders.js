import { ORDER_STATUS, ORDER_PRIORITY } from '../../constants/index.js';

const minimal = {
  userId: '507f1f77bcf86cd799439012', destinationAddress: 'Calle de prueba 123',
};
const example = {
  _id: '507f1f77bcf86cd799439031', ...minimal,
  status: ORDER_STATUS.PENDING, priority: ORDER_PRIORITY.NORMAL, __v: 0,
};
const parserDescription = 'Los errores del parser JSON también aplican si se envía un cuerpo: JSON malformado o null devuelve INVALID_JSON (400); más de 100 KB devuelve PAYLOAD_TOO_LARGE (413).';

export default {
  '/api/orders': {
    get: {
      tags: ['Orders'], operationId: 'getOrders', summary: 'Listar pedidos',
      description: 'Devuelve un array, posiblemente vacío, sin garantizar orden. Las referencias se devuelven como IDs, sin populate. ' + parserDescription,
      responses: {
        200: {
          description: 'Array de pedidos; [] si no existen registros.',
          content: { 'application/json': {
            schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
            examples: { populated: { value: [example] }, empty: { value: [] } },
          } },
        },
        400: { $ref: '#/components/responses/InvalidJson' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
    post: {
      tags: ['Orders'], operationId: 'createOrder', summary: 'Crear un pedido',
      description: 'Inserta un pedido. Exige userId válido de un usuario existente con rol USER (user); ADMIN y COURIER se rechazan con 400. Un usuario inexistente devuelve 404. La dirección se recorta. Se permiten todos los estados y prioridades del enum, sin reglas de transición. Los campos adicionales se ignoran. No crea ni modifica entregas. ' + parserDescription,
      requestBody: {
        required: true,
        content: { 'application/json': {
          schema: { $ref: '#/components/schemas/OrderCreate' },
          examples: {
            minimal: { value: minimal },
            complete: { value: { ...minimal, status: ORDER_STATUS.IN_PROGRESS, priority: ORDER_PRIORITY.HIGH } },
          },
        } },
      },
      responses: {
        201: {
          description: 'Pedido creado con defaults cuando se omiten status y priority. El ejemplo corresponde al body mínimo.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' }, example } },
        },
        400: { $ref: '#/components/responses/OrderBadRequest' },
        404: { $ref: '#/components/responses/OrderUserNotFound' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
  '/api/orders/{id}': {
    get: {
      tags: ['Orders'], operationId: 'getOrderById', summary: 'Consultar un pedido por ID',
      description: 'Valida el formato del identificador antes de consultar. Un ID válido sin pedido asociado devuelve 404. ' + parserDescription,
      parameters: [{
        name: 'id', in: 'path', required: true,
        description: 'ObjectId hexadecimal de 24 caracteres, sin espacios.',
        schema: { $ref: '#/components/schemas/ObjectId' }, example: example._id,
      }],
      responses: {
        200: {
          description: 'Pedido encontrado, con userId representado como ID.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' }, example } },
        },
        400: { $ref: '#/components/responses/OrderIdBadRequest' },
        404: { $ref: '#/components/responses/OrderNotFound' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
