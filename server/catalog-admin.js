import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { del } from '@vercel/blob';
import { aplicarCambios, fichaArtista, fichaCancion, rutaArchivo } from '../admin/modelo.js';
import { BRANCH, catalogAtHead, checkTicket, github, postGithub } from './song-upload.js';
import { HttpError, MAX_ADMIN_COVER, MAX_AUDIO, signTicket } from './upload-core.js';
import { readMedia } from './staged-media.js';

const kinds = ['caratula', 'audio'];
const hashPattern = /^[a-f0-9]{40}$/;
const invalid = () => new HttpError(400, 'Los datos de la edición no son válidos. Revisa la ficha.');
const changed = () =>
  new HttpError(
    409,
    'El archivo cambió desde que abriste la ficha. Revisa la versión actual antes de publicar.'
  );
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function jpegDimensions(bytes) {
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p++] === 0xff) {
    while (p < bytes.length && bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (marker === 0xda || marker === 0xd9 || p + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(p);
    if (length < 2 || p + length > bytes.length) break;
    if (
      length >= 8 &&
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    )
      return [bytes.readUInt16BE(p + 5), bytes.readUInt16BE(p + 3)];
    p += length;
  }
  throw new HttpError(400, 'No se pudieron leer las dimensiones de la carátula.');
}

export function mediaInfo(bytes, clase, propuesta) {
  const sha = createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
  if (propuesta?.sha !== sha || propuesta.bytes !== bytes.length)
    throw new HttpError(400, 'El archivo recibido difiere del borrador.');
  if (clase === 'audio') return { formato: 'MP3', bytes: bytes.length, sha };
  const [w, h] = jpegDimensions(bytes);
  const { ancho, alto } = propuesta;
  // Browsers apply EXIF orientation, including quarter turns, when measuring the image.
  if (!w || !h || w * h > 24_000_000 || !((ancho === w && alto === h) || (ancho === h && alto === w)))
    throw new HttpError(400, 'Revisa las dimensiones de la carátula.');
  return { formato: 'JPEG', bytes: bytes.length, ancho, alto, sha };
}

// Store large files individually. Only the final fast-forward updates the public catalog and its paths.
export async function prepararArchivo(user, body) {
  const { id, clase, url, meta } = body;
  if (!Number.isSafeInteger(id) || id < 1 || !kinds.includes(clase)) throw invalid();
  const ticket = checkTicket(body.ticket, user);
  if (ticket.purpose !== 'admin-upload') throw invalid();
  const bytes = await readMedia(url, ticket, clase === 'caratula' ? 'cover' : 'audio');
  const archivo = mediaInfo(bytes, clase, meta);
  const subido = await postGithub('git/blobs', {
    encoding: 'base64',
    content: bytes.toString('base64')
  });
  if (subido.sha !== archivo.sha)
    throw new HttpError(502, 'No se pudo verificar el archivo recibido por GitHub.');
  const exp = Date.now() + 3600000;
  const comprobante = signTicket(
    { id: ticket.id, sub: user.sub, exp, purpose: 'admin-file', cancion: id, clase, archivo },
    process.env.SONG_UPLOAD_SECRET
  );
  await Promise.allSettled([del(url)]);
  return { comprobante, exp };
}

function validMeta(meta, clase) {
  if (
    !object(meta) ||
    !hashPattern.test(meta.sha) ||
    !Number.isSafeInteger(meta.bytes) ||
    meta.bytes < 1
  )
    return false;
  if (clase === 'audio') return meta.formato === 'MP3' && meta.bytes <= MAX_AUDIO;
  return (
    meta.formato === 'JPEG' &&
    meta.bytes <= MAX_ADMIN_COVER &&
    Number.isSafeInteger(meta.ancho) &&
    Number.isSafeInteger(meta.alto) &&
    meta.ancho > 0 &&
    meta.alto > 0 &&
    meta.ancho * meta.alto <= 24_000_000
  );
}

function normalizarCambios(input, user) {
  if (!Array.isArray(input) || !input.length) throw invalid();
  const vistos = new Set(),
    archivos = [];
  const cambios = input.map((c) => {
    if (!object(c) || typeof c.clave !== 'string' || !object(c.despues) || vistos.has(c.clave))
      throw invalid();
    vistos.add(c.clave);
    const { clave, antes, despues, origen } = c;
    if (/^artista:ART-[0-9A-F]{1,32}$/.test(clave)) {
      if (clave !== 'artista:' + despues.id || (antes !== null && antes?.id !== despues.id))
        throw invalid();
      return { clave, antes, despues: fichaArtista(despues) };
    }
    if (
      !/^cancion:[1-9]\d*$/.test(clave) ||
      !object(antes) ||
      !Array.isArray(despues.artistaIds) ||
      !object(despues.archivos) ||
      !object(c.comprobantes || {})
    )
      throw invalid();
    const id = Number(clave.slice(8));
    if (
      !Number.isSafeInteger(id) ||
      Object.keys(despues.archivos).some((k) => !kinds.includes(k)) ||
      Object.keys(c.comprobantes || {}).some((k) => !kinds.includes(k))
    )
      throw invalid();
    const ficha = fichaCancion(despues);
    for (const clase of kinds) {
      const nuevo = ficha.archivos[clase],
        anterior = antes.archivos?.[clase];
      const recibo = c.comprobantes?.[clase];
      if (!recibo) {
        if (!equal(nuevo, anterior))
          throw new HttpError(400, 'Falta verificar el archivo de reemplazo.');
        continue;
      }
      const t = checkTicket(recibo, user);
      if (
        t.purpose !== 'admin-file' ||
        t.cancion !== id ||
        t.clase !== clase ||
        !validMeta(nuevo, clase) ||
        !equal(t.archivo, nuevo)
      )
        throw invalid();
      archivos.push({ path: rutaArchivo(id, clase), sha: nuevo.sha, anterior: anterior?.sha, origen });
    }
    if (typeof ficha.nombre !== 'string') throw invalid();
    ficha.nombre = ficha.nombre.trim();
    return { clave, antes, despues: ficha };
  });
  return { cambios, archivos };
}

export async function publicarCatalogo(user, entradas) {
  let lote;
  try {
    lote = normalizarCambios(entradas, user);
  } catch (e) {
    throw e instanceof HttpError ? e : invalid();
  }
  const actual = await catalogAtHead();
  let catalogo;
  try {
    catalogo = aplicarCambios(actual.catalog, lote.cambios, true);
  } catch (e) {
    throw new HttpError(e.message.startsWith('Otra edición') ? 409 : 400, e.message);
  }
  const tree = [];
  if (lote.archivos.length) {
    const listado = await github('git/trees/' + actual.tree + '?recursive=1');
    if (listado.truncated) throw new HttpError(502, 'GitHub no devolvió el catálogo completo.');
    const hashes = new Map(listado.tree.map((f) => [f.path, f.sha]));
    for (const f of lote.archivos) {
      if (hashes.get(f.path) === f.sha) continue;
      let anterior = f.anterior;
      if (!anterior && hashPattern.test(f.origen || ''))
        anterior = (await github('contents/' + f.path + '?ref=' + f.origen)).sha;
      if (!anterior || anterior !== hashes.get(f.path)) throw changed();
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: f.sha });
    }
  }
  if (!equal(catalogo, actual.catalog))
    tree.push({
      path: 'json/covers.json',
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(catalogo, null, 2) + '\n'
    });
  if (!tree.length) return { sha: actual.sha, catalogo };
  const arbol = await postGithub('git/trees', { base_tree: actual.tree, tree });
  const commit = await postGithub('git/commits', {
    message:
      'Actualizar catálogo musical: ' +
      lote.cambios
        .slice(0, 3)
        .map((c) => c.despues.nombre)
        .join(', '),
    tree: arbol.sha,
    parents: [actual.sha]
  });
  await github('git/refs/heads/' + BRANCH, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { sha: commit.sha, catalogo };
}
