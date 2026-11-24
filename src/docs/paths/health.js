export default {
  '/health': {
    get: {
      tags: ['Health'],
      operationId: 'getHealth',
      summary: 'Comprobar que el servidor responde',
      description: 'Indica que el proceso HTTP está operativo. No consulta MongoDB ni garantiza su disponibilidad permanente. En production el servidor exige una conexión inicial exitosa antes de escuchar. Los errores del parser aplican si se envía un cuerpo JSON.',
      responses: {
        200: {
          description: 'El servidor HTTP responde.',
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/HealthResponse' }, example: { status: 'ok', environment: 'production', uptime: 123, timestamp: '2026-11-23T15:00:00.000Z' },
          } },
        },
        400: { $ref: '#/components/responses/InvalidJson' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },
  },
};
