import { authenticateRequest, catalogAtHead, route, ticketFor } from '../server/song-upload.js';
import { HttpError } from '../server/upload-core.js';
import { prepararArchivo, publicarCatalogo } from '../server/catalog-admin.js';

export const config = { maxDuration: 300 };
export default route(['GET', 'POST'], async (req) => {
  if (process.env.VERCEL_ENV !== 'production')
    throw new HttpError(403, 'El catálogo público se administra desde grimminck.cl.');
  const user = await authenticateRequest(req);
  if (req.method === 'GET') {
    const { sha, catalog } = await catalogAtHead();
    return { sha, catalogo: catalog };
  }
  const body = req.body || {};
  switch (body.accion) {
    case 'preparar':
      return ticketFor(user, 'admin-upload');
    case 'archivo':
      return prepararArchivo(user, body);
    case 'publicar':
      return publicarCatalogo(user, body.cambios);
    default:
      throw new HttpError(400, 'Operación de catálogo inválida.');
  }
});
