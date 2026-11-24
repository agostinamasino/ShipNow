import { paginationParameters, paginationMedia } from '../pagination.js';
import { USER_ROLES } from '../../constants/index.js';

const example = {
  _id: '507f1f77bcf86cd799439012', name: 'Ana Pérez', email: 'ana@example.com',
  role: USER_ROLES.USER, __v: 0,
};

export default {
  '/api/users': {
    get: {
      parameters: paginationParameters,
      tags: ['Users'],
      operationId: 'getUsers',
      summary: 'Listar usuarios',
      description: 'Devuelve una página de usuarios guardados en MongoDB. Los errores del parser aplican si se envía un cuerpo JSON.',
      responses: {
        200: { description: 'Página ordenada por _id ascendente; data puede estar vacío.', content: { 'application/json': paginationMedia('UsersPage', example) } },
        400: { $ref: '#/components/responses/ListBadRequest' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
    post: {
      tags: ['Users'],
      operationId: 'createUser',
      summary: 'Crear un usuario',
      description: 'El correo se normaliza y comprueba antes de guardar. Una colisión con el índice único de email también devuelve 409. No existe autenticación.',
      requestBody: {
        required: true,
        content: { 'application/json': {
          schema: { $ref: '#/components/schemas/UserCreate' },
          examples: {
            minimal: { value: { name: 'Ana Pérez', email: 'ana@example.com' } },
            courier: { value: { name: 'Repartidor de prueba', email: 'courier@example.com', role: USER_ROLES.COURIER } },
          },
        } },
      },
      responses: {
        201: {
          description: 'Usuario guardado con email normalizado.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' }, example } },
        },
        400: { $ref: '#/components/responses/UserBadRequest' },
        409: { $ref: '#/components/responses/UserEmailConflict' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
