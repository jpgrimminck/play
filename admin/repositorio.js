import { aplicarCambios, rutaArchivo } from './modelo.js';

export const RAMA = 'prototipo-admin';
const REPO = 'jpgrimminck/play';
const API = 'https://api.github.com';
const RAIZ = '/repos/' + REPO + '/';
const CATALOGO = 'json/covers.json';
export const mediosRemotos = (sha) => 'https://raw.githubusercontent.com/' + REPO + '/' + sha + '/';

function cliente(token, transporte) {
  return async (ruta, metodo = 'GET', cuerpo) => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (cuerpo) headers['Content-Type'] = 'application/json';
    const respuesta = await transporte(API + ruta, {
      method: metodo,
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    if (!respuesta.ok) {
      if (respuesta.status === 401)
        throw new Error('GitHub no aceptó la credencial. Revisa su vigencia.');
      if (respuesta.status === 403)
        throw new Error(
          'GitHub rechazó el acceso. Revisa el permiso Contents de la credencial o vuelve a intentar más tarde.'
        );
      if ([409, 422].includes(respuesta.status))
        throw new Error(
          'La rama recibió otro cambio. Vuelve a guardar para revisar la versión más reciente.'
        );
      throw new Error('GitHub no pudo completar la operación (' + respuesta.status + ').');
    }
    return respuesta.json();
  };
}

async function leerCon(api) {
  const ref = await api(RAIZ + 'git/ref/heads/' + RAMA);
  const sha = ref.object.sha;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('La versión de la rama no es válida.');
  const archivo = await api(RAIZ + 'contents/' + CATALOGO + '?ref=' + sha);
  const bytes = Uint8Array.from(atob(archivo.content), (c) => c.charCodeAt(0));
  const catalogo = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(catalogo.artistas))
    throw new Error('Esta versión todavía no contiene el directorio de artistas.');
  return { sha, catalogo };
}

export function leerRama(transporte = fetch) {
  return leerCon(cliente('', transporte));
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result.split(',')[1]);
    lector.onerror = () => reject(new Error('No se pudo abrir el archivo seleccionado.'));
    lector.readAsDataURL(blob);
  });
}

// Only this fixed branch and catalog/media paths can be addressed by the editing interface.
export async function guardarEnRama(token, cambios, progreso = () => {}, transporte = fetch) {
  const api = cliente(token, transporte);
  const usuario = await api('/user');
  if (usuario.login.toLowerCase() !== 'jpgrimminck')
    throw new Error('Esta administración está habilitada para la cuenta jpgrimminck.');
  const actual = await leerCon(api);
  const nuevo = aplicarCambios(actual.catalogo, cambios, true);
  const commitBase = await api(RAIZ + 'git/commits/' + actual.sha);
  const entradas = [];
  const medios = cambios.filter(
    (c) => c.clave.startsWith('cancion:') && Object.keys(c.medios || {}).length
  );
  if (medios.length) {
    const arbol = await api(RAIZ + 'git/trees/' + commitBase.tree.sha + '?recursive=1');
    if (arbol.truncated) throw new Error('GitHub no devolvió el listado completo de archivos.');
    const archivos = new Map(arbol.tree.map((entrada) => [entrada.path, entrada.sha]));
    for (const cambio of medios) {
      const id = Number(cambio.clave.split(':')[1]);
      for (const clase of ['caratula', 'audio']) {
        const blob = cambio.medios[clase];
        if (!blob) continue;
        const path = rutaArchivo(id, clase);
        const hash = cambio.despues.archivos[clase].sha;
        if (archivos.get(path) === hash) continue;
        let anterior = cambio.antes?.archivos?.[clase]?.sha;
        if (!anterior && /^[a-f0-9]{40}$/.test(cambio.origen || '')) {
          anterior = (await api(RAIZ + 'contents/' + path + '?ref=' + cambio.origen)).sha;
        }
        if (!anterior || anterior !== archivos.get(path))
          throw new Error(
            'El archivo de «' +
              cambio.despues.nombre +
              '» cambió en la rama. Revisa la ficha antes de reemplazarlo.'
          );
        progreso(
          'Subiendo ' +
            (clase === 'audio' ? 'el audio' : 'la carátula') +
            ' de «' +
            cambio.despues.nombre +
            '»…'
        );
        const subido = await api(RAIZ + 'git/blobs', 'POST', {
          encoding: 'base64',
          content: await base64(blob)
        });
        if (subido.sha !== hash) throw new Error('GitHub no confirmó el contenido del archivo.');
        entradas.push({ path, mode: '100644', type: 'blob', sha: subido.sha });
      }
    }
  }
  if (JSON.stringify(nuevo) !== JSON.stringify(actual.catalogo)) {
    entradas.push({
      path: CATALOGO,
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(nuevo, null, 2) + '\n'
    });
  }
  if (!entradas.length) return actual;
  progreso('Guardando los cambios en la rama de prueba…');
  const arbol = await api(RAIZ + 'git/trees', 'POST', {
    base_tree: commitBase.tree.sha,
    tree: entradas
  });
  const commit = await api(RAIZ + 'git/commits', 'POST', {
    message:
      'Editar catálogo de prueba: ' +
      cambios
        .map((c) => c.despues.nombre)
        .slice(0, 3)
        .join(', '),
    tree: arbol.sha,
    parents: [actual.sha]
  });
  await api(RAIZ + 'git/refs/heads/' + RAMA, 'PATCH', { sha: commit.sha, force: false });
  return { sha: commit.sha, catalogo: nuevo };
}
