import { get, head } from '@vercel/blob';
import { HttpError, uploadLimit, uploadPath, validMedia } from './upload-core.js';

export async function readMedia(url, ticket, kind) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'Archivo inválido.');
  }
  if (
    parsed.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/.test(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    decodeURIComponent(parsed.pathname) !== `/${uploadPath(ticket, kind)}`
  )
    throw new HttpError(400, 'Archivo inválido.');
  const info = await head(url);
  if (
    info.pathname !== uploadPath(ticket, kind) ||
    info.size <= 0 ||
    info.size > uploadLimit(ticket, kind) ||
    info.contentType !== (kind === 'cover' ? 'image/jpeg' : 'audio/mpeg')
  )
    throw new HttpError(400, 'Formato o tamaño de archivo inválido.');
  const blob = await get(url, { access: 'private' });
  if (!blob || blob.statusCode !== 200) throw new HttpError(400, 'No se pudo leer el archivo subido.');
  const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
  if (bytes.length !== info.size || !validMedia(bytes, kind))
    throw new HttpError(
      400,
      kind === 'cover' ? 'La carátula debe ser JPEG.' : 'El audio debe ser un MP3 válido.'
    );
  return bytes;
}
