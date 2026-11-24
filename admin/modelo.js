export const TIPOS = { c: 'Cover', i: 'Inédita', y: 'YouTube' };
export const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
export const claveCancion = (id) => 'cancion:' + id;
export const claveArtista = (id) => 'artista:' + id;
export const rutaArchivo = (id, clase) =>
  clase === 'caratula' ? 'covers/cover' + id + '.jpeg' : 'songs/' + id + '.mp3';

export function nuevoId() {
  return 'ART-' + crypto.randomUUID().replaceAll('-', '').toUpperCase();
}

function textoValido(valor, max, vacio = false) {
  return (
    typeof valor === 'string' &&
    (vacio || valor.trim()) &&
    valor.length <= max &&
    !/[<>\u0000-\u001F]/.test(valor)
  );
}

export function fichaArtista({ id, nombre, referencia = '' }) {
  if (!/^ART-[0-9A-F]+$/.test(id) || !textoValido(nombre, 160) || !textoValido(referencia, 120, true))
    throw new Error('Revisa el nombre y la referencia del artista.');
  const ficha = { id, nombre: nombre.trim() };
  if (referencia.trim()) ficha.referencia = referencia.trim();
  return ficha;
}

export function fichaCancion(cancion) {
  const { nombre, tipo, artistaIds = [], archivos = {} } = cancion;
  return { nombre, tipo, artistaIds: [...artistaIds], archivos: structuredClone(archivos) };
}

export function validarCancion(ficha, artistas) {
  if (!textoValido(ficha.nombre, 160)) throw new Error('Escribe un nombre de hasta 160 caracteres.');
  if (!Object.hasOwn(TIPOS, ficha.tipo)) throw new Error('Elige el tipo de canción.');
  const seleccion = ficha.artistaIds;
  if (!seleccion.length) throw new Error('Elige al menos un artista.');
  if (
    new Set(seleccion).size !== seleccion.length ||
    seleccion.some((id) => !artistas.some((a) => a.id === id))
  )
    throw new Error('Revisa los artistas seleccionados.');
}

function iguales(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function estadoRegistro(catalogo, clave) {
  const [tipo, id] = clave.split(':');
  if (tipo === 'artista') return catalogo.artistas.find((a) => a.id === id) ?? null;
  const cancion = catalogo.covers.find((c) => c.id === Number(id));
  return cancion ? fichaCancion(cancion) : null;
}

export function aplicarCambios(original, cambios, comprobar = false) {
  const catalogo = structuredClone(original);
  const renombrados = new Set(),
    reasignadas = new Set();
  const ordenados = [...cambios].sort(
    (a, b) => Number(a.clave.startsWith('cancion:')) - Number(b.clave.startsWith('cancion:'))
  );
  for (const cambio of ordenados) {
    const antes = estadoRegistro(original, cambio.clave);
    if (comprobar && !iguales(antes, cambio.antes) && !iguales(antes, cambio.despues))
      throw new Error(
        'Otra edición cambió «' +
          (antes?.nombre || cambio.despues?.nombre || cambio.antes?.nombre || cambio.clave) +
          '» en el catálogo. Tus borradores siguen en este dispositivo.'
      );
    if (cambio.clave.startsWith('artista:')) {
      if (cambio.despues === null) continue;
      const ficha = fichaArtista(cambio.despues);
      const i = catalogo.artistas.findIndex((a) => a.id === ficha.id);
      if (i < 0) catalogo.artistas.push(ficha);
      else {
        const conservada = { ...catalogo.artistas[i], ...ficha };
        if (!ficha.referencia) delete conservada.referencia;
        catalogo.artistas[i] = conservada;
      }
      if (antes?.nombre !== ficha.nombre) renombrados.add(ficha.id);
    } else {
      const cancion = catalogo.covers.find((c) => claveCancion(c.id) === cambio.clave);
      if (!cancion) throw new Error('Ya no se encuentra esta canción en el catálogo.');
      validarCancion(cambio.despues, catalogo.artistas);
      if (!iguales(cancion.artistaIds, cambio.despues.artistaIds)) reasignadas.add(cancion.id);
      Object.assign(cancion, structuredClone(cambio.despues));
    }
  }
  for (const cambio of cambios) {
    if (!cambio.clave.startsWith('artista:') || cambio.despues !== null) continue;
    const id = cambio.clave.slice(8);
    if (catalogo.covers.some((c) => c.artistaIds?.includes(id)))
      throw new Error('Este artista tiene canciones asociadas a su ID. Retíralo de sus créditos antes de eliminarlo.');
    catalogo.artistas = catalogo.artistas.filter((a) => a.id !== id);
  }
  const nombres = new Map(catalogo.artistas.map((a) => [a.id, a.nombre]));
  for (const cancion of catalogo.covers) {
    if (reasignadas.has(cancion.id) || cancion.artistaIds?.some((id) => renombrados.has(id))) {
      cancion.artista = cancion.artistaIds.map((id) => nombres.get(id)).join(' y ');
    }
  }
  return catalogo;
}

export function etiquetaArtista(artista) {
  return [artista.nombre, artista.referencia, artista.id].filter(Boolean).join(' · ');
}

export function peso(bytes) {
  if (!Number.isFinite(bytes)) return 'Sin datos';
  const unidad = bytes >= 1000000 ? 'MB' : 'KB';
  const valor = bytes / (unidad === 'MB' ? 1000000 : 1000);
  return (
    valor.toLocaleString('es-CL', { maximumFractionDigits: unidad === 'MB' ? 2 : 1 }) + ' ' + unidad
  );
}
