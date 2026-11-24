import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { separarCredito } from '../catalogo-datos.js';
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const MAX_ADMIN_COVER = 20 * 1024 * 1024;
export const MAX_AUDIO = 30 * 1024 * 1024;
export function ownerClaims(claims, email) {
  if (!claims.sub || claims.email_verified !== true || claims.email?.toLowerCase() !== email.toLowerCase())
    throw new HttpError(403, 'Esta cuenta no está autorizada para subir canciones.');
  return { sub: claims.sub, email: claims.email, name: 'Juan Pablo' };
}
export function signTicket(data, secret) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function readTicket(ticket, secret, sub, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length > 2048) throw new HttpError(400, 'Subida inválida.');
  const [payload, signature, extra] = ticket.split('.');
  const expected = createHmac('sha256', secret).update(payload || '').digest();
  const supplied = Buffer.from(signature || '', 'base64url');
  if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new HttpError(403, 'Subida inválida.');
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw new HttpError(400, 'Subida inválida.'); }
  if (data.sub !== sub || !Number.isFinite(data.exp) || data.exp < now || !/^[0-9a-f-]{36}$/.test(data.id)) throw new HttpError(403, 'La subida venció. Inicia una nueva subida.');
  return data;
}
export function uploadPath(ticket, kind) {
  if (ticket.purpose && ticket.purpose !== 'admin-upload') throw new HttpError(400, 'Autorización de archivo inválida.');
  const folder = ticket.purpose === 'admin-upload' ? 'admin-staging' : 'song-staging';
  return `${folder}/${ticket.id}/${kind === 'cover' ? 'cover.jpeg' : 'audio.mp3'}`;
}
export function uploadLimit(ticket, kind) {
  if (kind === 'audio') return MAX_AUDIO;
  return ticket.purpose === 'admin-upload' ? MAX_ADMIN_COVER : 1024 * 1024;
}
export function metadata(body) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (Object.hasOwn(body, 'artistaIds')) {
    const ids = body.artistaIds;
    if (!nombre || nombre.length > 160 || !['c','i','y'].includes(body.tipo) ||
        !Array.isArray(ids) || ids.length < 1 || ids.length > 3 ||
        new Set(ids).size !== ids.length ||
        ids.some(id => typeof id !== 'string' || !/^ART-[0-9A-F]{1,32}$/.test(id)))
      throw new HttpError(400, 'Selecciona entre uno y tres artistas existentes.');
    return { nombre, artistaIds: [...ids], tipo: body.tipo };
  }
  const artista = typeof body.artista === 'string' ? body.artista.trim() : '';
  if (!nombre || nombre.length > 160 || !artista || artista.length > 160 || !['c','i','y'].includes(body.tipo)) throw new HttpError(400, 'Completa nombre, artista y tipo de canción.');
  return { nombre, artista, tipo: body.tipo };
}
export function appendSong(catalog, meta, uploadId, now = new Date().toISOString()) {
  if (!Array.isArray(catalog.covers) || catalog.covers.some(s => !Number.isSafeInteger(s.id) || s.id < 1)) throw new HttpError(500, 'El catálogo necesita revisión.');
  const ids = catalog.covers.map(s => s.id);
  const max = Math.max(0, ...ids);
  if (new Set(ids).size !== ids.length || ids.length !== max || catalog.totalCovers !== max) throw new HttpError(500, 'El catálogo tiene IDs inconsistentes. No se ha modificado.');
  const existing = catalog.covers.find(s => s.uploadId === uploadId);
  if (existing) return { catalog, song: existing, existing: true };
  let seleccion;
  if (Object.hasOwn(meta, 'artistaIds')) {
    const validada = metadata(meta);
    seleccion = validada.artistaIds.map(id => catalog.artistas?.find(a => a.id === id));
    if (seleccion.some(a => !a))
      throw new HttpError(400, 'Un artista ya no está disponible. Recarga y vuelve a seleccionarlo.');
    meta = { ...validada, artista: seleccion.map(a => a.nombre).join(' y ') };
  }
  const song = { id: max + 1, ...meta, uploadedAt: now, uploadId };
  const next = { ...catalog, totalCovers: song.id, covers: [...catalog.covers, song] };
  if (!seleccion && Array.isArray(catalog.artistas)) {
    next.artistas = [...catalog.artistas];
    const nombres = separarCredito(meta.artista);
    // Homonyms need an explicit selection in the editor; the original credit stays readable.
    if (nombres.every(nombre => next.artistas.filter(a => a.nombre === nombre).length <= 1)) {
      song.artistaIds = [];
      for (const nombre of nombres) {
        let ficha = next.artistas.find(a => a.nombre === nombre);
        if (!ficha) {
          ficha = { id: 'ART-' + randomUUID().replaceAll('-', '').toUpperCase(), nombre };
          next.artistas.push(ficha);
        }
        if (!song.artistaIds.includes(ficha.id)) song.artistaIds.push(ficha.id);
      }
    } else {
      song.artistaIds = [];
    }
  }
  return { catalog: next, song, existing: false };
}
export function validMedia(bytes, kind) {
  if (kind === 'cover') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length > 3 && (bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0));
}
