let apertura;
function abrir() {
  if (!apertura)
    apertura = new Promise((resolve, reject) => {
      const solicitud = indexedDB.open('grimminck-prototipo-admin-v1', 1);
      solicitud.onupgradeneeded = () =>
        solicitud.result.createObjectStore('cambios', { keyPath: 'clave' });
      solicitud.onsuccess = () => resolve(solicitud.result);
      solicitud.onerror = () => reject(solicitud.error);
    });
  return apertura;
}

export async function leerBorradores() {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const peticion = bd.transaction('cambios').objectStore('cambios').getAll();
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

// Compare and write in the same transaction so two open tabs cannot overwrite one another.
export async function cambiarBorradores(operaciones, conservarMasRecientes = false) {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const tx = bd.transaction('cambios', 'readwrite');
    const almacen = tx.objectStore('cambios');
    let conflicto = false;
    for (const { clave, revision, valor } of operaciones) {
      const lectura = almacen.get(clave);
      lectura.onsuccess = () => {
        if (lectura.result?.revision !== revision) {
          if (!conservarMasRecientes) {
            conflicto = true;
            tx.abort();
          }
          return;
        }
        if (valor) almacen.put(valor);
        else almacen.delete(clave);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        new Error(
          conflicto
            ? 'La ficha cambió en otra pestaña. Recarga antes de volver a editarla.'
            : 'El navegador no pudo guardar el borrador. Comprueba el espacio disponible.'
        )
      );
    tx.onerror = () => {};
  });
}
