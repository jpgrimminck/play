import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararCatalogo, cancionesDelAlumno, cancionVecina } from '../catalogo-datos.js';
import { authenticateRequest } from '../server/song-upload.js';

const canciones = prepararCatalogo([
  { id: 1, nombre: 'En dúo', artista: 'Josefa y Emilio', tipo: 'i' },
  { id: 5, nombre: 'Nuevo lanzamiento', artista: 'Juan José', tipo: 'c' },
  { id: 4, nombre: 'Otra canción', artista: 'Juan', tipo: 'c' },
  { id: 3, nombre: 'Black or White', artista: 'Josefa', tipo: 'c' },
  { id: 2, nombre: 'Josefa', artista: 'Grupo original', tipo: 'y' }
]);

test('un lanzamiento pasa a la portada al actualizar el catálogo', () => {
  assert.deepEqual(cancionesDelAlumno(canciones, '').map(x => x.id), [5, 4, 3, 2, 1]);
  assert.equal(prepararCatalogo([...canciones, { id: 137, nombre: 'Nueva', artista: 'Emma', tipo: 'c' }])[0].id, 137);
});

test('el filtro reconoce colaboraciones y respeta el nombre completo del alumno', () => {
  assert.deepEqual(cancionesDelAlumno(canciones, 'Emilio').map(x => x.id), [1]);
  assert.deepEqual(cancionesDelAlumno(canciones, 'Juan').map(x => x.id), [4]);
  assert.deepEqual(cancionesDelAlumno(canciones, 'Josefa').map(x => x.id), [3, 1]);
});

test('siguiente y anterior recorren solo el catálogo filtrado, incluso en los extremos', () => {
  const cola = cancionesDelAlumno(canciones, 'Josefa');
  assert.equal(cancionVecina(cola, 3, 1).id, 1);
  assert.equal(cancionVecina(cola, 3, -1).id, 1);
  assert.equal(cancionVecina(cola, 1, 1).id, 3);
  assert.equal(cancionVecina([], 3, 1), null);
});

test('la vista de prueba impide publicar canciones antes de acceder a servicios externos', async t => {
  const anterior = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  t.after(() => {
    if (anterior === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = anterior;
  });
  await assert.rejects(authenticateRequest({ method: 'POST' }), { status: 403 });
});
