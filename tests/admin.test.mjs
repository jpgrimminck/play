import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { aplicarCambios, fichaCancion, validarCancion, nuevoId, rutaArchivo } from '../admin/modelo.js';
import { guardarEnRama, RAMA } from '../admin/repositorio.js';
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
function transporteMock({ usuario = 'jpgrimminck', base = catalogo, rechazar = false } = {}) {
  const llamadas = [];
  async function enviar(url, opciones) {
    const path = new URL(url).pathname;
    const body = opciones.body && JSON.parse(opciones.body);
    llamadas.push({ path, method: opciones.method, body });
    let data;
    if (path === '/user') data = { login: usuario };
    else if (path.endsWith('/git/ref/heads/' + RAMA)) data = { object: { sha } };
    else if (path.endsWith('/contents/json/covers.json'))
      data = { content: Buffer.from(JSON.stringify(base)).toString('base64') };
    else if (path.endsWith('/git/commits/' + sha)) data = { tree: { sha: 'arbol-base' } };
    else if (path.endsWith('/git/trees/arbol-base'))
      data = { tree: [{ path: 'songs/1.mp3', sha: 'original' }] };
    else if (path.endsWith('/git/blobs')) data = { sha: 'audio-nuevo' };
    else if (path.endsWith('/git/trees')) data = { sha: 'arbol-nuevo' };
    else if (path.endsWith('/git/commits')) data = { sha: 'b'.repeat(40) };
    else if (path.endsWith('/git/refs/heads/' + RAMA))
      return Response.json({}, { status: rechazar ? 422 : 200 });
    else throw new Error('Ruta inesperada ' + path);
    return Response.json(data);
  }
  return { enviar, llamadas };
}

test('el guardado actualiza solo la rama de prueba y permite reintentar un conflicto', async () => {
  const mock = transporteMock();
  const r = await guardarEnRama('prueba', [cambioTitulo], undefined, mock.enviar);
  const ref = mock.llamadas.at(-1);
  assert.equal(ref.path, '/repos/jpgrimminck/play/git/refs/heads/prototipo-admin');
  assert.equal(ref.method, 'PATCH');
  assert.equal(ref.body.force, false);
  assert.equal(r.catalogo.covers[0].nombre, 'Título nuevo');
  const conflicto = transporteMock({ rechazar: true });
  await assert.rejects(
    guardarEnRama('prueba', [cambioTitulo], undefined, conflicto.enviar),
    /otro cambio/
  );
  const extranjero = transporteMock({ usuario: 'otro' });
  await assert.rejects(
    guardarEnRama('prueba', [cambioTitulo], undefined, extranjero.enviar),
    /jpgrimminck/
  );
  assert.equal(extranjero.llamadas.length, 1);
});

test('un archivo y su ficha se publican en un único árbol y se rechaza un reemplazo concurrente', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('sin red');
  });
  const anterior = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:audio/mpeg;base64,YQ==';
      this.onload();
    }
  };
  t.after(() => {
    if (anterior) globalThis.FileReader = anterior;
    else delete globalThis.FileReader;
  });
  const base = structuredClone(catalogo);
  base.covers[0].archivos.audio = { sha: 'original', bytes: 5, formato: 'MP3' };
  const antes = fichaCancion(base.covers[0]);
  const despues = { ...antes, archivos: { audio: { sha: 'audio-nuevo', bytes: 1, formato: 'MP3' } } };
  const cambio = { clave: 'cancion:1', antes, despues, medios: { audio: new Blob(['a']) } };
  const mock = transporteMock({ base });
  await guardarEnRama('prueba', [cambio], undefined, mock.enviar);
  const arbol = mock.llamadas.find((c) => c.path.endsWith('/git/trees'));
  assert.deepEqual(
    arbol.body.tree.map((f) => f.path),
    ['songs/1.mp3', 'json/covers.json']
  );
  assert.equal(mock.llamadas.filter((c) => c.method === 'PATCH').length, 1);
  base.covers[0].archivos.audio.sha = 'otra-revision';
  const otra = { ...cambio, antes: fichaCancion(base.covers[0]) };
  const colision = transporteMock({ base });
  await assert.rejects(guardarEnRama('prueba', [otra], undefined, colision.enviar), /cambió en la rama/);
  assert.ok(colision.llamadas.every((c) => c.method === 'GET'));
});
