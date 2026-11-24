const normalizar = value => String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
export function coincidenciasArtistas(artistas, seleccion, texto) {
  const q = normalizar(texto);
  return artistas.filter(a => !seleccion.includes(a.id) &&
    normalizar([a.nombre,a.referencia,a.id].filter(Boolean).join(' ')).includes(q))
    .sort((a,b) => a.nombre.localeCompare(b.nombre,'es') || a.id.localeCompare(b.id));
}
export function seleccionValida(artistas, seleccion) {
  return Array.isArray(seleccion) && seleccion.length >= 1 && seleccion.length <= 3 &&
    new Set(seleccion).size === seleccion.length && seleccion.every(id => artistas.some(a => a.id === id));
}
