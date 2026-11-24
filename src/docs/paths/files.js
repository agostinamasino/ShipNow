import { paginationParameters, paginationMedia } from '../pagination.js';
import { DOCUMENT_TYPES, FILE_OWNERS, FILE_MIME_TYPES } from '../../constants/index.js';

function operations({ ownerModel, ownerId, schema, documentType, prefix, tag }) {
  const example = {
    _id: '507f1f77bcf86cd799439051', ownerModel, ownerId,
    originalName: 'documento.pdf', filename: '5de0805a-f569-4ee2-a2b5-ea567c767991.pdf',
    path: `${prefix}/5de0805a-f569-4ee2-a2b5-ea567c767991.pdf`,
    mimeType: FILE_MIME_TYPES.PDF, size: 1234, documentType,
    uploadedAt: '2026-11-16T15:00:00.000Z', __v: 0,
  };
  const parameters = [{ name: 'id', in: 'path', required: true,
    description: `ObjectId hexadecimal de 24 caracteres de un ${ownerModel} existente. Los IDs de ejemplo son ilustrativos; reemplazarlos por entidades reales antes de ejecutar.`,
    schema: { $ref: '#/components/schemas/ObjectId' }, example: ownerId }];
  const globalErrors = 'Los errores globales INVALID_JSON (400) y PAYLOAD_TOO_LARGE (413, límite JSON de 100 KB) pueden ocurrir antes de resolver la ruta si se envía un cuerpo JSON. Los archivos multipart tienen su límite propio de 5 MiB.';
  return {
    post: {
      tags: [tag], operationId: ownerModel === FILE_OWNERS.USER ? 'uploadUserDocument' : 'uploadOrderReceipt',
      summary: ownerModel === FILE_OWNERS.USER ? 'Subir un documento de usuario' : 'Subir un comprobante de pedido',
      description: 'ATENCIÓN: ejecutar esta operación ESCRIBE un archivo y metadatos en la base configurada. Valida ID y existencia antes de iniciar la escritura. Recibe exactamente un archivo file y un documentType, en cualquier orden; rechaza campos desconocidos o repetidos. Admite PDF, JPEG y PNG hasta 5 MiB, con validación de MIME, extensión y firma básica. ownerModel y ownerId provienen exclusivamente de la ruta. Limpieza compensatoria ante fallos; no hay atomicidad entre disco y MongoDB. No dispone de autenticación. El contenido se recupera exclusivamente por el endpoint de descarga controlada usando el _id de los metadatos. ' + globalErrors,
      parameters,
      requestBody: { required: true, content: { 'multipart/form-data': {
        schema: { $ref: `#/components/schemas/${schema}` },
        encoding: { file: { contentType: Object.values(FILE_MIME_TYPES).join(', ') } },
      } } },
      responses: {
        201: { description: 'Metadatos guardados y asociados; el archivo permanece en almacenamiento local.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UploadedFile' }, example } } },
        400: { $ref: '#/components/responses/FileBadRequest' },
        404: { $ref: '#/components/responses/FileEntityNotFound' },
        413: { $ref: '#/components/responses/FileTooLarge' },
        415: { $ref: '#/components/responses/FileInvalidType' },
        500: { $ref: '#/components/responses/FileServerError' },
      },
    },
    get: {
      tags: [tag], operationId: ownerModel === FILE_OWNERS.USER ? 'getUserDocuments' : 'getOrderReceipts',
      summary: ownerModel === FILE_OWNERS.USER ? 'Consultar metadatos de documentos de usuario' : 'Consultar metadatos de comprobantes de pedido',
      description: 'Valida ID y existencia. Filtra por ownerModel y ownerId; no mezcla entidades. Devuelve metadatos, sin contenido binario ni enlaces públicos. No hay garantía de orden; una entidad existente sin archivos devuelve []. Una entidad inexistente devuelve 404. ' + globalErrors,
      parameters: [...parameters, ...paginationParameters],
      responses: {
        200: { description: 'Página de metadatos asociados, posiblemente vacía.', content: { 'application/json': paginationMedia('UploadedFilesPage', example) } },
        400: { $ref: '#/components/responses/FileReadBadRequest' },
        404: { $ref: '#/components/responses/FileEntityNotFound' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  };
}

export default {
  '/api/users/{id}/documents': operations({ ownerModel: FILE_OWNERS.USER, ownerId: '507f1f77bcf86cd799439011', schema: 'UserDocumentUpload', documentType: DOCUMENT_TYPES.IDENTITY, prefix: 'users/documents', tag: 'Users' }),
  '/api/orders/{id}/receipts': operations({ ownerModel: FILE_OWNERS.ORDER, ownerId: '507f1f77bcf86cd799439021', schema: 'OrderReceiptUpload', documentType: DOCUMENT_TYPES.DELIVERY_PROOF, prefix: 'orders/receipts', tag: 'Orders' }),
  '/api/files/{fileId}/download': {
    get: {
      tags: ['Users', 'Orders'], operationId: 'downloadFile', summary: 'Descargar un archivo asociado',
      description: 'Busca metadatos y comprueba que su User u Order todavía exista. No recibe rutas del cliente. Valida la ruta almacenada, confinamiento en la raíz, ausencia de symlinks, archivo regular y MIME permitido. Devuelve bytes con nombre UUID seguro y attachment, sin publicar uploads mediante express.static. No tiene autenticación ni autorización. Un archivo inexistente (metadatos o contenido) devuelve 404. Una ruta almacenada insegura o fallo de lectura devuelve 500 antes de enviar headers. Si falla después, se interrumpe el binario sin agregar JSON; la cancelación cierra el descriptor sin borrar la asociación. Los errores globales INVALID_JSON y PAYLOAD_TOO_LARGE aplican si se envía un cuerpo JSON.',
      parameters: [{ name: 'fileId', in: 'path', required: true,
        description: 'ObjectId de los metadatos obtenido del POST o GET de documentos/comprobantes; no es el ID de User u Order.',
        schema: { $ref: '#/components/schemas/ObjectId' }, example: '507f1f77bcf86cd799439051' }],
      responses: {
        200: {
          description: 'Contenido binario completo. No devuelve JSON ni elimina el archivo.',
          headers: {
            'Content-Disposition': { description: 'Descarga como adjunto con nombre generado seguro.', schema: { type: 'string' }, example: 'attachment; filename="5de0805a-f569-4ee2-a2b5-ea567c767991.pdf"' },
            'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
            'Content-Length': { description: 'Tamaño real en disco, en bytes.', schema: { type: 'integer', minimum: 1 } },
          },
          content: Object.fromEntries(Object.values(FILE_MIME_TYPES).map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])),
        },
        400: { $ref: '#/components/responses/FileDownloadBadRequest' },
        404: { $ref: '#/components/responses/FileDownloadNotFound' },
        413: { $ref: '#/components/responses/PayloadTooLarge' },
        500: { $ref: '#/components/responses/FileDownloadServerError' },
      },
    },
  },
};
