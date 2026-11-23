import { upload } from '@vercel/blob/client';

const endpoint = '/api/catalog-admin';
const comprobantes = new Map();
export const mediosRemotos = (sha) => 'https://raw.githubusercontent.com/jpgrimminck/play/' + sha + '/';

export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      data.error || 'El servidor no pudo completar la operación. Vuelve a intentar.'
    );
    error.status = res.status;
    throw error;
  }
  return data;
}
const enviar = (body) => api(endpoint, { method: 'POST', body });
export const leerCatalogo = () => api(endpoint);

async function subirArchivo(cambio, clase, blob, progreso) {
  const id = Number(cambio.clave.slice(8));
  const meta = cambio.despues.archivos[clase];
  const clave = id + ':' + clase + ':' + meta.sha;
  const anterior = comprobantes.get(clave);
  if (anterior && anterior.exp > Date.now() + 60000) return anterior.comprobante;
  const { ticket, uploadId } = await enviar({ accion: 'preparar' });
  const imagen = clase === 'caratula';
  const prefijo = (imagen ? 'Carátula' : 'Audio') + ' de «' + cambio.despues.nombre + '»';
  progreso('Subiendo ' + prefijo + '…');
  const archivo = await upload(
    'admin-staging/' + uploadId + (imagen ? '/cover.jpeg' : '/audio.mp3'),
    blob,
    {
      access: 'private',
      handleUploadUrl: '/api/song-upload/blob',
      clientPayload: JSON.stringify({ ticket }),
      contentType: imagen ? 'image/jpeg' : 'audio/mpeg',
      multipart: true,
      onUploadProgress: ({ percentage }) => progreso(prefijo + ' · ' + Math.round(percentage) + ' %')
    }
  );
  progreso('Verificando ' + prefijo + '…');
  const resultado = await enviar({ accion: 'archivo', id, clase, meta, ticket, url: archivo.url });
  comprobantes.set(clave, resultado);
  return resultado.comprobante;
}

export async function publicarCambios(cambios, progreso) {
  const preparados = [];
  for (const c of cambios) {
    const fila = {
      clave: c.clave,
      antes: c.antes,
      despues: c.despues,
      origen: c.origen,
      comprobantes: {}
    };
    for (const [clase, blob] of Object.entries(c.medios || {})) {
      fila.comprobantes[clase] = await subirArchivo(c, clase, blob, progreso);
    }
    preparados.push(fila);
  }
  progreso('Guardando los cambios en el catálogo de grimminck.cl…');
  const guardado = await enviar({ accion: 'publicar', cambios: preparados });
  comprobantes.clear();
  return guardado;
}
