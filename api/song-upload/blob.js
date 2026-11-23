import { handleUpload } from '@vercel/blob/client';
import { authenticateRequest, checkTicket, route } from '../../server/song-upload.js';
import { HttpError, uploadLimit, uploadPath } from '../../server/upload-core.js';
export default route('POST', async req => handleUpload({
  body: req.body,
  request: req,
  onBeforeGenerateToken: async (pathname, clientPayload) => {
    let payload; try { payload = JSON.parse(clientPayload); } catch { throw new HttpError(400, 'Subida inválida.'); }
    const user = await authenticateRequest(req);
    const ticket = checkTicket(payload.ticket, user);
    const kind = pathname === uploadPath(ticket, 'cover') ? 'cover' : pathname === uploadPath(ticket, 'audio') ? 'audio' : null;
    if (!kind) throw new HttpError(400, 'Ruta de archivo inválida.');
    return { allowedContentTypes: [kind === 'cover' ? 'image/jpeg' : 'audio/mpeg'], maximumSizeInBytes: uploadLimit(ticket, kind), addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 600000 };
  },
  onUploadCompleted: async () => {},
}));
