import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY } from '../../constants/index.js';

const user = {
  _id: '507f1f77bcf86cd799439021', name: 'Usuario de prueba 1',
  email: 'user.e147be38-41b9-4ddb-bbd7-77f2c6121f72.1@example.com', role: USER_ROLES.USER,
};
const courier = {
  _id: '507f1f77bcf86cd799439023', name: 'Repartidor de prueba 1',
  email: 'courier.e147be38-41b9-4ddb-bbd7-77f2c6121f72.1@example.com', role: USER_ROLES.COURIER,
};
const order = {
  _id: '507f1f77bcf86cd799439031', userId: user._id, status: ORDER_STATUS.PENDING,
  priority: ORDER_PRIORITY.NORMAL, destinationAddress: 'Calle de prueba 1',
};
const delivery = {
  _id: '507f1f77bcf86cd799439041', orderId: order._id, courierId: courier._id,
  status: DELIVERY_STATUS.ASSIGNED,
};
const qtyDescription = 'Entero de 0 a 100, 10 por defecto. Cero devuelve arrays vacíos. Se rechazan negativos, decimales, valores vacíos, repetidos y notación exponencial.';

function preview({ tags, operationId, summary, description, schema, example }) {
  return {
    get: {
      tags, operationId, summary,
      description: 'Genera un lote independiente en memoria, sin insertar documentos en MongoDB ni requerir conexión. '
        + description + ' Los errores globales del parser aplican si se envía un cuerpo JSON.',
      parameters: [{
        name: 'qty', in: 'query', required: false, description: qtyDescription,
        schema: { type: 'integer', minimum: 0, maximum: 100, default: 10 },
      }],
      responses: {
        200: {
          description: 'Vista previa con sus entidades relacionadas. El ejemplo representa qty=1.',
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` }, example } },
        },
        400: { $ref: '#/components/responses/MockBadRequest' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  };
}

export default {
  '/api/mocks/users': preview({
    tags: ['Users', 'Mocks'], operationId: 'getMockUsers', summary: 'Simular usuarios',
    description: 'Todos los usuarios tienen rol USER y correos ficticios únicos.',
    schema: 'MockUsersResponse', example: { users: [user] },
  }),
  '/api/mocks/couriers': preview({
    tags: ['Users', 'Mocks'], operationId: 'getMockCouriers', summary: 'Simular repartidores',
    description: 'Los repartidores son usuarios con rol COURIER, sin colección de identidad separada.',
    schema: 'MockCouriersResponse', example: { couriers: [courier] },
  }),
  '/api/mocks/orders': preview({
    tags: ['Orders', 'Mocks'], operationId: 'getMockOrders', summary: 'Simular pedidos y sus usuarios',
    description: 'Cada userId coincide con un _id de users en esta respuesta. Los pedidos están pending y sus prioridades pertenecen al enum real.',
    schema: 'MockOrdersResponse', example: { orders: [order], users: [user] },
  }),
  '/api/mocks/deliveries': preview({
    tags: ['Deliveries', 'Mocks'], operationId: 'getMockDeliveries', summary: 'Simular entregas con sus relaciones',
    description: 'Incluye deliveries, orders, users y couriers. Cada orderId y courierId coincide con un _id de las listas relacionadas. Los pedidos referencian usuarios USER y los repartidores son COURIER. Entregas assigned/in_transit tienen pedidos in_progress; entregas delivered tienen pedidos delivered.',
    schema: 'MockDeliveriesResponse',
    example: { deliveries: [delivery], orders: [{ ...order, status: ORDER_STATUS.IN_PROGRESS }], users: [user], couriers: [courier] },
  }),
  '/api/mocks/seed': {
    post: {
      tags: ['Mocks'], operationId: 'seedMocks', summary: 'Insertar un lote de prueba relacionado',
      description: 'ATENCIÓN: ejecutar este endpoint desde Swagger UI INSERTA datos reales en la base configurada. '
        + 'Con qty=10 se crean 10 usuarios, 10 repartidores, 10 pedidos y 10 entregas (40 documentos). '
        + 'qty admite 1–25, sin valor predeterminado. Alternativamente, enviá un body con cantidades explícitas, '
        + 'enteras no negativas. Los campos omitidos cuentan como cero. El total permitido es de 1 a 100 documentos. '
        + 'No se admiten campos desconocidos ni combinar qty con un body no vacío; {} con qty sí está permitido. '
        + 'Los pedidos requieren usuarios. Las entregas requieren pedidos y repartidores, con un pedido distinto por entrega. '
        + 'Las referencias usan los IDs del mismo lote. Se inserta en una transacción, sin borrar ni sobrescribir datos previos. '
        + 'Requiere MongoDB Atlas o un replica set compatible con transacciones. Un fallo revierte todo el lote. '
        + 'Las dependencias y la suma de cantidades se validan en el service; OpenAPI describe esas reglas entre query y body.',
      parameters: [{
        name: 'qty', in: 'query', required: false,
        description: 'Cantidad de cada entidad. Si se usa, el body se omite o es {}. El total es qty × 4.',
        schema: { type: 'integer', minimum: 1, maximum: 25 },
      }],
      requestBody: {
        required: false,
        description: 'Alternativa a qty. Con este formato, omití qty en la URL. {} solo es válido si se proporciona qty.',
        content: { 'application/json': {
          schema: { $ref: '#/components/schemas/SeedRequest' },
          examples: {
            explicitCounts: { value: { users: 2, couriers: 2, orders: 3, deliveries: 3 } },
            queryMode: { summary: 'Body vacío permitido junto con qty', value: {} },
          },
        } },
      },
      responses: {
        201: {
          description: 'Lote confirmado. El ejemplo corresponde al body con cantidades explícitas.',
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/SeedResponse' },
            example: {
              batchId: 'e147be38-41b9-4ddb-bbd7-77f2c6121f72',
              counts: { users: 2, couriers: 2, orders: 3, deliveries: 3 },
              ids: {
                users: [user._id, '507f1f77bcf86cd799439022'],
                couriers: [courier._id, '507f1f77bcf86cd799439024'],
                orders: [order._id, '507f1f77bcf86cd799439032', '507f1f77bcf86cd799439033'],
                deliveries: [delivery._id, '507f1f77bcf86cd799439042', '507f1f77bcf86cd799439043'],
              },
            },
          } },
        },
        400: { $ref: '#/components/responses/SeedBadRequest' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        503: { $ref: '#/components/responses/SeedUnavailable' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
