export default {
  '/health': {
    get: {
      tags: ['Health'],
      operationId: 'getHealth',
      summary: 'Comprobar que el servidor responde',
      description: 'Responde independientemente de MongoDB. No consulta la base. Los errores del parser aplican si se envía un cuerpo JSON.',
      responses: {
        200: {
          description: 'El servidor HTTP responde.',
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/HealthResponse' }, example: { status: 'ok' },
          } },
        },
        400: { $ref: '#/components/responses/InvalidJson' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },
  },
};
