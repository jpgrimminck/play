import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { aplicarCambios, fichaCancion, validarCancion, nuevoId, rutaArchivo } from '../admin/modelo.js';
import handler from '../api/catalog-admin.js';
import { createSession, SESSION_COOKIE } from '../server/upload-session.js';
import { checkTicket } from '../server/song-upload.js';
import { mediaInfo } from '../server/catalog-admin.js';
import { signTicket, uploadPath, uploadLimit, MAX_ADMIN_COVER } from '../server/upload-core.js';
import { createHash } from 'node:crypto';
import {
  prepararCatalogo,
  opcionesAlumnos,
  resolverAlumno,
  cancionesDelAlumno
} from '../catalogo-datos.js';
import { appendSong } from '../server/upload-core.js';

const a = { id: 'ART-001', nombre: 'Josefa', referencia: 'Solista' };
const b = { id: 'ART-002', nombre: 'Josefa', referencia: 'Dúo' };
const primera = {
  id: 1,
  nombre: 'Canción 1',
  artista: 'Josefa',
  tipo: 'c',
  artistaIds: [a.id],
  archivos: {},
  uploadId: 'heredado'
};
const segunda = { ...primera, id: 2, nombre: 'Canción 2', artistaIds: [b.id] };
const catalogo = { totalCovers: 2, covers: [primera, segunda], artistas: [a, b] };
const cambioTitulo = {
  clave: 'cancion:1',
  antes: fichaCancion(primera),
  despues: { ...fichaCancion(primera), nombre: 'Título nuevo' }
};
const renombrar = { clave: 'artista:' + a.id, antes: a, despues: { ...a, nombre: 'Josefa A' } };

test('los homónimos tienen repertorios independientes; renombrar afecta solo a los créditos vinculados', () => {
  const siguiente = aplicarCambios(catalogo, [renombrar], true);
  assert.deepEqual(
    siguiente.covers.map((c) => c.artista),
    ['Josefa A', 'Josefa']
  );
  assert.equal(siguiente.covers[0].uploadId, 'heredado');
  const canciones = prepararCatalogo(catalogo.covers, catalogo.artistas);
  const opciones = opcionesAlumnos(canciones, catalogo.artistas);
  assert.notEqual(opciones[0].etiqueta, opciones[1].etiqueta);
  assert.equal(resolverAlumno('Josefa', opciones), '');
  assert.equal(resolverAlumno('Josefa', opciones, canciones[0]), b.id);
  assert.deepEqual(
    cancionesDelAlumno(canciones, a.id).map((c) => c.id),
    [1]
  );
});

test('permite crear un artista homónimo y asignar varios IDs en un mismo guardado', () => {
  const tercero = { id: nuevoId(), nombre: 'Josefa' };
  const cancion = {
    ...cambioTitulo,
    despues: { ...cambioTitulo.despues, artistaIds: [tercero.id, b.id] }
  };
  const nuevo = aplicarCambios(
    catalogo,
    [cancion, { clave: 'artista:' + tercero.id, antes: null, despues: tercero }],
    true
  );
  assert.equal(nuevo.artistas.length, 3);
  assert.deepEqual(nuevo.covers[0].artistaIds, [tercero.id, b.id]);
  assert.equal(nuevo.covers[0].artista, 'Josefa y Josefa');
  assert.equal(catalogo.covers[0].nombre, 'Canción 1');
});

test('reintentar es idempotente y un cambio en la misma ficha se detecta sin pisarlo', () => {
  const nuevo = aplicarCambios(catalogo, [cambioTitulo], true);
  assert.deepEqual(aplicarCambios(nuevo, [cambioTitulo], true), nuevo);
  assert.throws(
    () =>
      aplicarCambios(
        nuevo,
        [{ ...cambioTitulo, despues: { ...cambioTitulo.despues, nombre: 'Otro título' } }],
        true
      ),
    /Otra edición/
  );
  assert.doesNotThrow(() => aplicarCambios(nuevo, [renombrar], true));
  assert.throws(() => validarCancion({ ...cambioTitulo.despues, artistaIds: [] }, [a, b]), /al menos/);
  assert.throws(
    () => validarCancion({ ...cambioTitulo.despues, artistaIds: [a.id, a.id] }, [a, b]),
    /Revisa/
  );
});

test('las cargas nuevas conservan el registro y no atribuyen una grabación a un homónimo por su nombre', () => {
  const nueva = appendSong(catalogo, { nombre: 'Tema', artista: 'Josefa', tipo: 'c' }, 'subida');
  assert.deepEqual(nueva.song.artistaIds, []);
  assert.equal(nueva.song.artista, 'Josefa');
  const otra = appendSong(catalogo, { nombre: 'Tema', artista: 'Juan y Pedro', tipo: 'c' }, 'otra');
  assert.equal(otra.song.artistaIds.length, 2);
  assert.equal(otra.catalog.artistas.length, 4);
  assert.equal(catalogo.artistas.length, 2);
});

test('el catálogo de la rama contiene IDs únicos, medios medidos y créditos completos', async () => {
  const datos = JSON.parse(await readFile(new URL('../json/covers.json', import.meta.url)));
  const ids = new Set(datos.artistas.map((a) => a.id));
  assert.equal(ids.size, datos.artistas.length);
  for (const c of datos.covers) {
    assert.ok(c.artistaIds.every((id) => ids.has(id)));
    for (const [clase, m] of Object.entries(c.archivos || {})) {
      const path = new URL('../' + rutaArchivo(c.id, clase), import.meta.url);
      assert.equal((await stat(path)).size, m.bytes);
      assert.match(m.sha, /^[a-f0-9]{40}$/);
      if (clase === 'caratula') assert.ok(m.ancho > 0 && m.alto > 0);
    }
  }
});

const sha = 'a'.repeat(40);
const usuario = { sub: 'dueño-de-prueba', email: 'test@example.org', name: 'Juan Pablo' };
const secreto = 'clave-de-sesion-solo-para-estas-pruebas';
const origen = 'https://www.grimminck.cl';
function entorno(t) {
  const env = {
    VERCEL_ENV: 'production',
    VERCEL_BLOB_CALLBACK_URL: 'https://www.grimminck.cl/api/song-upload/blob',
    SONG_UPLOAD_GITHUB_TOKEN: 'github-prueba',
    SONG_UPLOAD_SECRET: secreto,
    SONG_UPLOAD_OWNER_EMAIL: usuario.email,
    GOOGLE_CLIENT_ID: 'cliente-de-prueba',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_mockstore_prueba'
  };
  for (const [key, value] of Object.entries(env)) {
    const previo = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previo === undefined) delete process.env[key];
      else process.env[key] = previo;
    });
  }
}
async function llamar(metodo, body, token, origenPeticion = origen) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
  await handler(
    {
      method: metodo,
      body,
      headers: {
        host: 'www.grimminck.cl',
        origin: origenPeticion,
        cookie: token ? SESSION_COOKIE + '=' + token : ''
      }
    },
    res
  );
  return res;
}
function gitSimulado(t, { base = catalogo, rechazar = false, archivos = {} } = {}) {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.github.com');
    const path = u.pathname.replace('/repos/jpgrimminck/play/', '');
    const body = opciones.body && JSON.parse(opciones.body);
    llamadas.push({ path, method: opciones.method || 'GET', body });
    if (path === 'git/ref/heads/production') return Response.json({ object: { sha } });
    if (path === 'git/commits/' + sha) return Response.json({ tree: { sha: 'arbol-base' } });
    if (path === 'contents/json/covers.json')
      return Response.json({ content: Buffer.from(JSON.stringify(base)).toString('base64') });
    if (path === 'git/trees/arbol-base')
      return Response.json({ tree: Object.entries(archivos).map(([path, sha]) => ({ path, sha })) });
    if (path === 'git/trees') return Response.json({ sha: 'arbol-nuevo' });
    if (path === 'git/commits') return Response.json({ sha: 'b'.repeat(40) });
    if (path === 'git/refs/heads/production') return Response.json({}, { status: rechazar ? 422 : 200 });
    throw new Error('Petición inesperada ' + path);
  });
  return llamadas;
}

test('el administrador exige la sesión del propietario y rechaza escrituras externas y de preview', async (t) => {
  entorno(t);
  const llamadas = gitSimulado(t);
  for (const metodo of ['GET', 'POST'])
    assert.equal((await llamar(metodo, { accion: 'preparar' })).code, 401);
  const token = await createSession(usuario, secreto);
  assert.equal((await llamar('POST', { accion: 'preparar' }, token, 'https://otro.example')).code, 403);
  const ajeno = await createSession({ ...usuario, email: 'otra@example.org' }, secreto);
  assert.equal((await llamar('GET', undefined, ajeno)).code, 403);
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await llamar('POST', { accion: 'publicar', cambios: [cambioTitulo] }, token)).code, 403);
  assert.equal(llamadas.length, 0);
});

test('la sesión de subida sirve para leer y publicar en production sin credencial de GitHub en el cliente', async (t) => {
  entorno(t);
  const llamadas = gitSimulado(t),
    token = await createSession(usuario, secreto);
  const lectura = await llamar('GET', undefined, token);
  assert.deepEqual(lectura.body, { sha, catalogo });
  const guardado = await llamar('POST', { accion: 'publicar', cambios: [cambioTitulo] }, token);
  assert.equal(guardado.code, 200);
  assert.equal(guardado.body.catalogo.covers[0].nombre, 'Título nuevo');
  const cambios = llamadas.find((c) => c.path === 'git/trees').body.tree;
  assert.deepEqual(
    cambios.map((c) => c.path),
    ['json/covers.json']
  );
  assert.equal(llamadas.at(-1).path, 'git/refs/heads/production');
  assert.deepEqual(llamadas.at(-1).body, { sha: 'b'.repeat(40), force: false });
});

test('una edición concurrente conserva el historial y repetir un cambio publicado no crea otro commit', async (t) => {
  entorno(t);
  const token = await createSession(usuario, secreto);
  const llamadas = gitSimulado(t, { rechazar: true });
  assert.equal((await llamar('POST', { accion: 'publicar', cambios: [cambioTitulo] }, token)).code, 409);
  assert.equal(llamadas.filter((c) => c.method === 'PATCH').length, 1);
  t.mock.restoreAll();
  const reintento = gitSimulado(t, { base: aplicarCambios(catalogo, [cambioTitulo]) });
  assert.equal((await llamar('POST', { accion: 'publicar', cambios: [cambioTitulo] }, token)).code, 200);
  assert.ok(reintento.every((c) => c.method === 'GET'));
});

test('los permisos del editor y de subir canciones tienen rutas y límites distintos', async (t) => {
  entorno(t);
  const token = await createSession(usuario, secreto);
  const r = await llamar('POST', { accion: 'preparar' }, token);
  assert.equal(r.code, 200);
  const dt = checkTicket(r.body.ticket, usuario);
  assert.equal(dt.purpose, 'admin-upload');
  assert.equal(uploadPath(dt, 'cover'), 'admin-staging/' + dt.id + '/cover.jpeg');
  assert.equal(uploadLimit(dt, 'cover'), MAX_ADMIN_COVER);
  assert.equal(uploadLimit({ id: dt.id }, 'cover'), 1024 * 1024);
  const legado = signTicket({ id: dt.id, sub: usuario.sub, exp: Date.now() + 10000 }, secreto);
  const ajeno = await llamar(
    'POST',
    { accion: 'archivo', id: 1, clase: 'audio', ticket: legado },
    token
  );
  assert.equal(ajeno.code, 400);
});

test('un reemplazo exige comprobante de esa canción y archivo, y se publica junto a los datos', async (t) => {
  entorno(t);
  const base = structuredClone(catalogo),
    token = await createSession(usuario, secreto);
  const oldHash = '2'.repeat(40),
    newHash = '4'.repeat(40);
  base.covers[0].archivos.audio = { formato: 'MP3', bytes: 120, sha: oldHash };
  const antes = fichaCancion(base.covers[0]),
    nuevo = { formato: 'MP3', bytes: 100, sha: newHash };
  const despues = { ...antes, archivos: { audio: nuevo } };
  const firma = (cancion) =>
    signTicket(
      {
        id: crypto.randomUUID(),
        sub: usuario.sub,
        purpose: 'admin-file',
        cancion,
        clase: 'audio',
        archivo: nuevo,
        exp: Date.now() + 100000
      },
      secreto
    );
  const cambio = { clave: 'cancion:1', antes, despues, comprobantes: {} };
  const llamadas = gitSimulado(t, { base, archivos: { 'songs/1.mp3': oldHash } });
  const publicar = () => llamar('POST', { accion: 'publicar', cambios: [cambio] }, token);
  assert.equal((await publicar()).code, 400);
  cambio.comprobantes.audio = firma(2);
  assert.equal((await publicar()).code, 400);
  assert.equal(llamadas.length, 0);
  cambio.comprobantes.audio = firma(1);
  assert.equal((await publicar()).code, 200);
  assert.deepEqual(
    llamadas.find((c) => c.path === 'git/trees').body.tree.map((f) => f.path),
    ['songs/1.mp3', 'json/covers.json']
  );
  t.mock.restoreAll();
  const externas = gitSimulado(t, { base, archivos: { 'songs/1.mp3': '3'.repeat(40) } });
  assert.equal((await publicar()).code, 409);
  assert.ok(externas.every((c) => c.method === 'GET'));
});

test('se calculan las dimensiones y la huella a partir del archivo recibido', async () => {
  const bytes = jpegPrueba();
  const hash = createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
  const meta = { bytes: bytes.length, sha: hash, ancho: 3, alto: 2, formato: 'JPEG' };
  assert.deepEqual(mediaInfo(bytes, 'caratula', meta), meta);
  assert.throws(() => mediaInfo(bytes, 'caratula', { ...meta, ancho: 1 }), { status: 400 });
  assert.throws(() => mediaInfo(bytes, 'caratula', { ...meta, sha: 'otro' }), { status: 400 });
});

function jpegPrueba() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCHALkZ/9k=',
    'base64'
  );
}

test('una carátula privada pasa por la autorización de carga y genera un comprobante vinculado a su contenido', async (t) => {
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
  const { default: autorizarBlob } = await import('../api/song-upload/blob.js');
  entorno(t);
  const transporte = new MockAgent(),
    original = getGlobalDispatcher();
  transporte.disableNetConnect();
  setGlobalDispatcher(transporte);
  t.after(async () => {
    setGlobalDispatcher(original);
    await transporte.close();
  });
  const token = await createSession(usuario, secreto);
  const permiso = await llamar('POST', { accion: 'preparar' }, token);
  const { ticket, uploadId } = permiso.body;
  const pathname = 'admin-staging/' + uploadId + '/cover.jpeg';
  const body = {
    type: 'blob.generate-client-token',
    payload: { pathname, clientPayload: JSON.stringify({ ticket }), multipart: true }
  };
  const respuesta = {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  const host = 'www.grimminck.cl';
  await autorizarBlob(
    { method: 'POST', headers: { host, origin: origen, cookie: SESSION_COOKIE + '=' + token }, body },
    respuesta
  );
  assert.equal(respuesta.code, 200, JSON.stringify(respuesta.body));
  assert.ok(respuesta.body.clientToken);
  const bytes = jpegPrueba();
  const meta = {
    formato: 'JPEG',
    bytes: bytes.length,
    ancho: 3,
    alto: 2,
    sha: createHash('sha1')
      .update('blob ' + bytes.length + '\0')
      .update(bytes)
      .digest('hex')
  };
  const url = 'https://mockstore.private.blob.vercel-storage.com/' + pathname;
  const vercel = transporte.get('https://vercel.com');
  vercel
    .intercept({ method: 'GET', path: '/api/blob?' + new URLSearchParams({ url }) })
    .reply(200, { url, pathname, size: bytes.length, contentType: 'image/jpeg' });
  transporte
    .get('https://mockstore.private.blob.vercel-storage.com')
    .intercept({ method: 'GET', path: '/' + pathname })
    .reply(200, bytes);
  vercel.intercept({ method: 'POST', path: '/api/blob/delete' }).reply(200, {});
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    assert.equal(target, 'https://api.github.com/repos/jpgrimminck/play/git/blobs');
    assert.deepEqual(JSON.parse(options.body), {
      encoding: 'base64',
      content: bytes.toString('base64')
    });
    return Response.json({ sha: meta.sha });
  });
  const r = await llamar(
    'POST',
    { accion: 'archivo', id: 1, clase: 'caratula', ticket, url, meta },
    token
  );
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const comprobante = checkTicket(r.body.comprobante, usuario);
  assert.equal(comprobante.purpose, 'admin-file');
  assert.equal(comprobante.cancion, 1);
  assert.deepEqual(comprobante.archivo, meta);
  transporte.assertNoPendingInterceptors();
});
