// Las pistas "y" acreditan al artista de referencia. Las grabaciones "c" e "i" acreditan a sus intérpretes.
export function separarCredito(texto) {
  return String(texto || '').split(/\s+y\s+|\s*&\s*|\s*,\s*/iu).map(nombre => nombre.trim()).filter(Boolean);
}

export function prepararCatalogo(entradas, artistas = []) {
  const ids = new Set(artistas.map(a => a.id));
  return entradas
    .filter(cancion => Number.isSafeInteger(cancion.id) && cancion.id > 0 && cancion.nombre)
    .map(cancion => {
      const artista = String(cancion.artista || '').trim();
      let alumnos = [];
      if (cancion.tipo !== 'y') {
        alumnos = Array.isArray(cancion.artistaIds) ? cancion.artistaIds.filter(id => ids.has(id)) : separarCredito(artista);
      }
      return { ...cancion, artista, alumnos };
    })
    .sort((a, b) => b.id - a.id);
}

export function opcionesAlumnos(catalogo, artistas) {
  const fichas = new Map(artistas.map(a => [a.id, a]));
  const ids = [...new Set(catalogo.flatMap(c => c.alumnos))];
  const nombres = ids.map(id => fichas.get(id)?.nombre || id);
  return ids.map((id, i) => {
    const nombre = nombres[i];
    const repetido = nombres.indexOf(nombre) !== nombres.lastIndexOf(nombre);
    const ficha = fichas.get(id);
    return { id, nombre, etiqueta: repetido && ficha ? [nombre, ficha.referencia, id].filter(Boolean).join(' · ') : nombre };
  }).sort((a,b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

export function resolverAlumno(valor, opciones, cancion) {
  if (!valor) return '';
  if (opciones.some(a => a.id === valor)) return valor;
  const coincidencias = opciones.filter(a => a.nombre === valor && (!cancion || cancion.alumnos.includes(a.id)));
  return coincidencias.length === 1 ? coincidencias[0].id : '';
}

export function cancionesDelAlumno(catalogo, alumno) {
  return alumno ? catalogo.filter(cancion => cancion.alumnos.includes(alumno)) : catalogo;
}

export function cancionVecina(cola, id, paso) {
  const indice = cola.findIndex(cancion => cancion.id === id);
  if (indice < 0 || !cola.length) return null;
  return cola[(indice + paso + cola.length) % cola.length];
}
