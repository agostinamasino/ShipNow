export default {
  '/api/logger-test': {
    get: {
      tags: ['Logger'], operationId: 'loggerTest', summary: 'Verificar los seis niveles de Winston',
      description: 'Herramienta de validación disponible únicamente en development. Emite debug, http, info, warning, error y fatal con mensajes fijos de demostración. El evento fatal no termina el servidor. En production y test la ruta no se registra y responde 404 ROUTE_NOT_FOUND. La operación permanece visible en Swagger en todos los entornos. Los errores del parser aplican si se envía un cuerpo JSON.',
      responses: {
        200: {
          description: 'Demostración ejecutada en desarrollo.',
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/HealthResponse' }, example: { status: 'ok' },
          } },
        },
        400: { $ref: '#/components/responses/InvalidJson' },
        404: { $ref: '#/components/responses/RouteNotFound' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
