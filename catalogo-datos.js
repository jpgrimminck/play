// Las pistas "y" acreditan al artista de referencia. Las grabaciones "c" e "i" acreditan a sus intérpretes.
export function prepararCatalogo(entradas) {
  return entradas
    .filter(cancion => Number.isSafeInteger(cancion.id) && cancion.id > 0 && cancion.nombre)
    .map(cancion => {
      const artista = String(cancion.artista || '').trim();
      const alumnos = cancion.tipo === 'y' ? [] : artista.split(/\s+y\s+|\s*&\s*|\s*,\s*/iu).map(nombre => nombre.trim()).filter(Boolean);
      return { ...cancion, artista, alumnos };
    })
    .sort((a, b) => b.id - a.id);
}

export function cancionesDelAlumno(catalogo, alumno) {
  return alumno ? catalogo.filter(cancion => cancion.alumnos.includes(alumno)) : catalogo;
}

export function cancionVecina(cola, id, paso) {
  const indice = cola.findIndex(cancion => cancion.id === id);
  if (indice < 0 || !cola.length) return null;
  return cola[(indice + paso + cola.length) % cola.length];
}
