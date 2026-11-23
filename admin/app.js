import {
  TIPOS,
  aplicarCambios,
  claveArtista,
  claveCancion,
  estadoRegistro,
  etiquetaArtista,
  fichaArtista,
  fichaCancion,
  normalizar,
  nuevoId,
  peso,
  rutaArchivo,
  validarCancion
} from './modelo.js';
import { cambiarBorradores, leerBorradores } from './borradores.js';
import { medirArchivo, prepararAudio, prepararCaratula } from './medios.js';
import { api, publicarCambios, leerCatalogo, mediosRemotos } from './repositorio.js';
import { accesoDelEditor } from './acceso.js';

const $ = (id) => document.getElementById(id);
const nodo = (tag, clase, texto) => {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
};
function icono(nombre) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'),
    use = document.createElementNS(ns, 'use');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#i-' + nombre);
  svg.append(use);
  return svg;
}
function boton(texto, clase, accion, simbolo) {
  const b = nodo('button', clase);
  b.type = 'button';
  if (simbolo) b.append(icono(simbolo));
  b.append(document.createTextNode(texto));
  b.addEventListener('click', accion);
  return b;
}
const idBreve = (id) => (id.length > 15 ? id.slice(0, 12) : id);
let base,
  catalogo,
  sha = '',
  shaCompilado = '',
  borradores = [],
  modo = 'canciones',
  elegido = null,
  idNuevo = '';
let hashActual = '',
  filtroTipo = '',
  inicial,
  ficha,
  revisionInicial,
  origenEdicion,
  nuevosMedios = {};
let sucio = false,
  preparando = 0,
  publicando = false,
  guardando = false,
  generacion = 0,
  temporalAviso;
let seleccionTemporal = [],
  baseEdicion,
  metaCalculada = {};
const busquedas = { canciones: '', artistas: '' },
  urls = new Map();
const movil = matchMedia('(max-width:48rem)');
const canal =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('grimminck-admin-borradores') : null;
function aviso(texto) {
  clearTimeout(temporalAviso);
  $('anuncio').textContent = texto;
  temporalAviso = setTimeout(() => {
    $('anuncio').textContent = '';
  }, 6000);
}
function avisoBase(texto) {
  $('error-inicial').textContent = texto;
  $('error-inicial').hidden = !texto;
}
function cambioDe(clave) {
  return borradores.find((c) => c.clave === clave);
}
function urlMedio(id, clase, enEdicion = false) {
  const pendiente = enEdicion ? nuevosMedios[clase] : null;
  const blob = pendiente || cambioDe(claveCancion(id))?.medios?.[clase];
  if (blob) {
    if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
    return urls.get(blob);
  }
  return (sha && sha !== shaCompilado ? mediosRemotos(sha) : '/') + rutaArchivo(id, clase);
}
function limpiarUrls() {
  const activos = new Set([
    ...borradores.flatMap((c) => Object.values(c.medios || {})),
    ...Object.values(nuevosMedios)
  ]);
  for (const [blob, url] of urls)
    if (!activos.has(blob)) {
      URL.revokeObjectURL(url);
      urls.delete(blob);
    }
}
const buscarArtista = (id) => catalogo.artistas.find((a) => a.id === id);
const nombres = (ids) =>
  ids
    .map(buscarArtista)
    .filter(Boolean)
    .map((a) => a.nombre)
    .join(' y ');
function avatar(nombre) {
  const iniciales = nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const el = nodo('span', 'avatar', iniciales || '+');
  el.setAttribute('aria-hidden', 'true');
  return el;
}
function foto(id, alt = '', editar = false) {
  const img = new Image();
  img.alt = alt;
  img.loading = alt ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.src = urlMedio(id, 'caratula', editar);
  return img;
}
function fila(item, esCancion, accion, actual = false) {
  const clave = esCancion ? claveCancion(item.id) : claveArtista(item.id);
  const b = nodo('button', 'fila');
  b.type = 'button';
  if (actual) b.setAttribute('aria-current', 'true');
  b.append(esCancion ? foto(item.id) : avatar(item.nombre));
  const letras = nodo('span', 'fila-letras');
  letras.append(
    nodo('strong', '', item.nombre),
    nodo(
      'small',
      '',
      esCancion ? item.artista : [idBreve(item.id), item.referencia].filter(Boolean).join(' · ')
    )
  );
  b.append(letras);
  if (cambioDe(clave)) {
    const marca = nodo('span', 'marca-borrador');
    marca.setAttribute('aria-label', 'Borrador local');
    b.append(marca);
  }
  b.append(icono('next'));
  b.addEventListener('click', accion);
  return b;
}
function listar() {
  const esCancion = modo === 'canciones',
    q = normalizar(busquedas[modo]);
  let items;
  if (esCancion) {
    items = catalogo.covers
      .filter(
        (c) =>
          (!filtroTipo || c.tipo === filtroTipo) &&
          normalizar([c.nombre, c.artista, c.id, ...(c.artistaIds || [])].join(' ')).includes(q)
      )
      .sort((a, b) => b.id - a.id);
  } else {
    items = catalogo.artistas
      .filter((a) => normalizar(etiquetaArtista(a)).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id));
  }
  const primeroVisible = items[0];
  if (!elegido && primeroVisible && !movil.matches) elegido = primeroVisible.id;
  $('lista').replaceChildren(
    ...items.map((item) =>
      fila(
        item,
        esCancion,
        () => ir('#' + (esCancion ? 'cancion-' : 'artista-') + item.id),
        elegido === item.id
      )
    )
  );
  if (!items.length)
    $('lista').append(nodo('p', 'mensaje-vacio', 'Sin resultados. Prueba con otro nombre o ID.'));
  $('resultado').textContent = items.length.toLocaleString('es-CL');
  $('lista-titulo').textContent = esCancion ? 'Canciones' : 'Artistas';
  $('buscar').placeholder = esCancion
    ? 'Buscar canción o artista'
    : 'Buscar por nombre, referencia o ID';
  $('buscar').setAttribute('aria-label', $('buscar').placeholder);
  $('buscar').value = busquedas[modo];
  $('filtros').hidden = !esCancion;
  $('nuevo').hidden = esCancion;
  $('tab-canciones').setAttribute('aria-pressed', String(esCancion));
  $('tab-artistas').setAttribute('aria-pressed', String(!esCancion));
  for (const b of $('filtros').querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b.dataset.tipo === filtroTipo));
}
function resumen() {
  $('resumen').textContent =
    catalogo.covers.length + ' canciones · ' + catalogo.artistas.length + ' artistas';
  $('pendientes').textContent = borradores.length;
  $('pendientes').hidden = !borradores.length;
}
function confirmar(texto) {
  return new Promise((resolve) => {
    const d = $('confirmar');
    $('confirmar-texto').textContent = texto;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'descartar'), { once: true });
    d.showModal();
    $('conservar').focus();
  });
}
$('conservar').onclick = () => $('confirmar').close('conservar');
$('descartar').onclick = () => $('confirmar').close('descartar');
async function puedeSalir() {
  if (publicando || guardando || preparando) return false;
  return !sucio || confirmar('Los cambios que todavía no guardaste en esta ficha se perderán.');
}
async function ir(hash, historial = true) {
  if (!catalogo || !(await puedeSalir())) return;
  if (historial && location.hash !== hash) history.pushState(null, '', hash);
  abrirRuta(hash, true);
}
window.addEventListener('popstate', async () => {
  if (!catalogo) return;
  if (await puedeSalir()) abrirRuta(location.hash, true);
  else history.pushState(null, '', hashActual || location.pathname);
});
window.addEventListener('beforeunload', (e) => {
  if (sucio || preparando || publicando || guardando) {
    e.preventDefault();
    e.returnValue = '';
  }
});
function abrirRuta(hash, enfocar = false) {
  hashActual = hash;
  modo = hash.startsWith('#artista') ? 'artistas' : 'canciones';
  const cancion = /^#cancion-(\d+)$/.exec(hash);
  const artista = /^#artista-(ART-[0-9A-F]+)$/.exec(hash);
  elegido =
    cancion && catalogo.covers.some((c) => c.id === Number(cancion[1])) ? Number(cancion[1]) : null;
  if (artista && (buscarArtista(artista[1]) || artista[1] === idNuevo)) elegido = artista[1];
  const abierta = elegido !== null;
  document.body.classList.toggle('ficha-abierta', abierta);
  listar();
  editar();
  resumen();
  if (movil.matches && enfocar) {
    window.scrollTo(0, 0);
    (abierta ? $('volver') : $('buscar')).focus({ preventScroll: true });
  }
}
function actualizarPie() {
  if (!ficha) return;
  sucio = JSON.stringify(ficha) !== JSON.stringify(inicial);
  const b = $('guardar-ficha'),
    estado = $('estado-ficha');
  if (b) b.disabled = !sucio || preparando > 0 || guardando;
  if (estado)
    estado.textContent = preparando
      ? 'Preparando archivo…'
      : guardando
        ? 'Guardando…'
        : sucio
          ? 'Cambios sin guardar'
          : revisionInicial
            ? 'Borrador en este dispositivo'
            : 'Versión del catálogo';
}
function campo(id, etiqueta, valor, max, alCambiar, opcional = false) {
  const label = nodo('label', 'campo', etiqueta);
  const input = nodo('input');
  input.id = id;
  input.value = valor;
  input.required = !opcional;
  input.maxLength = max;
  input.autocomplete = 'off';
  input.addEventListener('input', () => alCambiar(input.value));
  label.append(input);
  return label;
}
function bloque(titulo) {
  const s = nodo('section', 'bloque');
  s.append(nodo('h3', '', titulo));
  return s;
}
function cabeceraFicha(esCancion) {
  const h = nodo('header', 'hero-ficha'),
    texto = nodo('div');
  const visual = esCancion ? foto(elegido, 'Carátula de ' + ficha.nombre, true) : avatar(ficha.nombre);
  visual.id = 'imagen-ficha';
  const id = nodo(
    'span',
    'id-ficha',
    esCancion ? 'CANCIÓN #' + elegido : 'ARTISTA · ' + idBreve(elegido)
  );
  const titulo = nodo('h2', '', ficha.nombre || 'Nuevo artista');
  titulo.id = 'titulo-ficha';
  const credito = nodo(
    'p',
    '',
    esCancion
      ? nombres(ficha.artistaIds) || catalogo.covers.find((c) => c.id === elegido)?.artista
      : ficha.referencia || ''
  );
  credito.id = 'subtitulo-ficha';
  texto.append(id, titulo, credito);
  if (esCancion) {
    const tipo = nodo('span', 'tipo-tag', TIPOS[ficha.tipo]);
    tipo.id = 'etiqueta-tipo';
    texto.append(tipo);
  }
  h.append(visual, texto);
  return h;
}
function pintarCreditos() {
  const chips = $('chips');
  if (!chips) return;
  chips.replaceChildren(
    ...ficha.artistaIds
      .map(buscarArtista)
      .filter(Boolean)
      .map((a) => {
        const chip = nodo('span', 'chip');
        chip.append(
          document.createTextNode(a.nombre),
          nodo('small', '', [a.referencia, idBreve(a.id)].filter(Boolean).join(' · '))
        );
        chip.title = etiquetaArtista(a);
        return chip;
      })
  );
  if (!chips.childElementCount) chips.append(nodo('span', 'ayuda', 'Selecciona al menos un artista.'));
}
function datosCancion() {
  const s = bloque('Información de la canción'),
    campos = nodo('div', 'campos');
  campos.append(
    campo('nombre-cancion', 'Nombre de la canción', ficha.nombre, 160, (valor) => {
      ficha.nombre = valor;
      $('titulo-ficha').textContent = valor.trim() || 'Sin título';
      actualizarPie();
    })
  );
  const tipo = nodo('div', 'etiqueta', 'Tipo de canción'),
    grupo = nodo('div', 'tipos');
  grupo.setAttribute('role', 'group');
  grupo.setAttribute('aria-label', 'Tipo de canción');
  for (const [valor, nombre] of Object.entries(TIPOS)) {
    const b = boton(nombre, 'tipo-opcion', () => {
      ficha.tipo = valor;
      $('etiqueta-tipo').textContent = nombre;
      for (const otro of grupo.children) otro.setAttribute('aria-pressed', String(otro === b));
      actualizarPie();
    });
    b.setAttribute('aria-pressed', String(ficha.tipo === valor));
    grupo.append(b);
  }
  tipo.append(grupo);
  campos.append(tipo);
  const creditos = nodo('div', 'creditos'),
    fila = nodo('div'),
    chips = nodo('div', 'chips');
  chips.id = 'chips';
  fila.append(
    nodo('span', 'etiqueta', 'Artistas'),
    boton('Elegir artistas', 'boton-texto', abrirSelector, 'users')
  );
  creditos.append(fila, chips);
  s.append(campos, creditos);
  return s;
}
function pintarMedida(clase) {
  const dl = $('datos-' + clase);
  if (!dl) return;
  const m = nuevosMedios[clase]
    ? ficha.archivos[clase]
    : metaCalculada[clase] || ficha.archivos[clase] || {};
  const pares = [
    ['Formato', m.formato || 'Cargando…'],
    ['Peso', Number.isFinite(m.bytes) ? peso(m.bytes) : 'Cargando…']
  ];
  if (clase === 'caratula')
    pares.push(['Dimensiones', m.ancho && m.alto ? m.ancho + ' × ' + m.alto + ' px' : 'Cargando…']);
  dl.replaceChildren();
  for (const [k, v] of pares) {
    const dd = nodo('dd', '', v);
    if (k === 'Peso' && Number.isFinite(m.bytes)) dd.title = m.bytes.toLocaleString('es-CL') + ' bytes';
    dl.append(nodo('dt', '', k), dd);
  }
}
async function medirAnterior(clase, turno) {
  try {
    const meta = await medirArchivo(urlMedio(elegido, clase), clase, ficha.archivos[clase]);
    if (turno === generacion) {
      metaCalculada[clase] = meta;
      pintarMedida(clase);
    }
  } catch {
    if (turno === generacion && !ficha.archivos[clase] && $('datos-' + clase))
      $('datos-' + clase).textContent = 'No se pudieron leer los datos del archivo.';
  }
}
function mediosCancion() {
  const s = bloque('Archivos'),
    grid = nodo('div', 'medios');
  for (const clase of ['caratula', 'audio']) {
    const esFoto = clase === 'caratula',
      panel = nodo('div', 'medio');
    const h = nodo('h4');
    h.append(icono(esFoto ? 'photo' : 'wave'), document.createTextNode(esFoto ? 'Carátula' : 'Audio'));
    const dl = nodo('dl');
    dl.id = 'datos-' + clase;
    panel.append(h, dl);
    if (!esFoto) {
      const audio = nodo('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.id = 'audio-ficha';
      audio.src = urlMedio(elegido, 'audio', true);
      audio.setAttribute('aria-label', 'Escuchar audio de la canción');
      panel.append(audio);
    }
    panel.append(
      nodo(
        'p',
        'ayuda',
        esFoto
          ? 'JPG, PNG o WebP · hasta 20 MiB. Se guarda en JPEG con sus dimensiones.'
          : 'MP3 · hasta 30 MiB.'
      )
    );
    const label = nodo('label', 'boton linea elegir'),
      input = nodo('input');
    const titulo = esFoto ? 'Cambiar carátula' : 'Cambiar audio';
    label.append(icono('upload'), document.createTextNode(titulo));
    input.type = 'file';
    input.id = 'archivo-' + clase;
    input.accept = esFoto ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' : '.mp3,audio/mpeg';
    input.setAttribute('aria-label', titulo);
    input.addEventListener('change', () => reemplazar(input, clase));
    label.append(input);
    panel.append(label);
    grid.append(panel);
  }
  s.append(grid);
  return s;
}
async function reemplazar(input, clase) {
  const archivo = input.files[0];
  input.value = '';
  if (!archivo || guardando) return;
  const turno = generacion;
  preparando++;
  input.disabled = true;
  actualizarPie();
  try {
    const r = await (clase === 'caratula' ? prepararCaratula(archivo) : prepararAudio(archivo));
    if (turno !== generacion) return;
    nuevosMedios[clase] = r.blob;
    ficha.archivos[clase] = r.meta;
    if (clase === 'caratula') $('imagen-ficha').src = urlMedio(elegido, clase, true);
    else {
      $('audio-ficha').pause();
      $('audio-ficha').src = urlMedio(elegido, clase, true);
    }
    pintarMedida(clase);
    limpiarUrls();
    aviso('Archivo preparado. Puedes revisarlo antes de guardar.');
  } catch (e) {
    aviso(e.message);
  } finally {
    if (turno === generacion) {
      preparando--;
      input.disabled = false;
      actualizarPie();
    }
  }
}
function datosArtista() {
  const s = bloque('Ficha del artista');
  const campos = nodo('div', 'campos');
  campos.append(
    campo('nombre-artista', 'Nombre del artista', ficha.nombre, 160, (valor) => {
      ficha.nombre = valor;
      $('titulo-ficha').textContent = valor.trim() || 'Nuevo artista';
      actualizarPie();
    }),
    campo(
      'referencia',
      'Referencia (opcional)',
      ficha.referencia || '',
      120,
      (valor) => {
        if (valor) ficha.referencia = valor;
        else delete ficha.referencia;
        $('subtitulo-ficha').textContent = valor;
        actualizarPie();
      },
      true
    )
  );
  const id = nodo('p', 'ficha-ref', 'ID permanente');
  id.append(nodo('code', 'id-grande', elegido));
  s.append(
    campos,
    id,
    nodo(
      'p',
      'ayuda',
      'La referencia ayuda a distinguir artistas con el mismo nombre. Forma parte del catálogo del repositorio.'
    )
  );
  return s;
}
function editar() {
  generacion++;
  preparando = 0;
  sucio = false;
  ficha = null;
  nuevosMedios = {};
  metaCalculada = {};
  limpiarUrls();
  const caja = $('contenido');
  $('audio-ficha')?.pause();
  caja.replaceChildren();
  if (elegido === null) {
    caja.append(nodo('p', 'mensaje-vacio', 'Selecciona una ficha del catálogo.'));
    return;
  }
  const esCancion = modo === 'canciones',
    clave = esCancion ? claveCancion(elegido) : claveArtista(elegido);
  const item = esCancion ? catalogo.covers.find((c) => c.id === elegido) : buscarArtista(elegido);
  if (!item && (esCancion || elegido !== idNuevo)) return;
  const cambio = cambioDe(clave);
  revisionInicial = cambio?.revision;
  origenEdicion = cambio?.origen || sha || shaCompilado;
  baseEdicion = cambio ? cambio.antes : estadoRegistro(base, clave);
  ficha = esCancion ? fichaCancion(item) : structuredClone(item || { id: elegido, nombre: '' });
  inicial = structuredClone(ficha);
  caja.append(cabeceraFicha(esCancion));
  if (esCancion) {
    caja.append(datosCancion(), mediosCancion());
    pintarCreditos();
    for (const clase of ['caratula', 'audio']) {
      pintarMedida(clase);
      if (!cambioDe(clave)?.medios?.[clase]) medirAnterior(clase, generacion);
    }
  } else {
    caja.append(datosArtista());
    const temas = catalogo.covers
      .filter((c) => c.artistaIds?.includes(elegido))
      .sort((a, b) => b.id - a.id);
    const s = bloque('Canciones vinculadas · ' + temas.length),
      lista = nodo('div', 'pistas');
    lista.append(...temas.map((c) => fila(c, true, () => ir('#cancion-' + c.id))));
    if (!temas.length) lista.append(nodo('p', 'ayuda', 'Todavía no tiene canciones asignadas.'));
    s.append(lista);
    caja.append(s);
  }
  const pie = nodo('footer', 'pie-ficha'),
    estado = nodo('p'),
    guardar = boton('Guardar borrador', 'boton primario', guardarFicha, 'check');
  estado.id = 'estado-ficha';
  estado.setAttribute('role', 'status');
  guardar.id = 'guardar-ficha';
  const acciones = nodo('div', 'acciones-ficha');
  if (cambio) acciones.append(boton('Descartar borrador', 'boton-texto', () => descartarFicha(clave)));
  acciones.append(guardar);
  pie.append(estado, acciones);
  caja.append(pie);
  actualizarPie();
}
function abrirSelector() {
  seleccionTemporal = [...ficha.artistaIds];
  $('buscar-artista').value = '';
  pintarSelector();
  $('selector').showModal();
  $('buscar-artista').focus();
}
function pintarSelector() {
  const q = normalizar($('buscar-artista').value);
  const items = catalogo.artistas
    .filter((a) => normalizar(etiquetaArtista(a)).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id));
  const opciones = $('opciones');
  opciones.replaceChildren();
  for (const a of items) {
    const label = nodo('label', 'opcion'),
      check = nodo('input'),
      textos = nodo('span');
    check.type = 'checkbox';
    check.checked = seleccionTemporal.includes(a.id);
    check.value = a.id;
    check.addEventListener('change', () => {
      if (check.checked) seleccionTemporal.push(a.id);
      else seleccionTemporal = seleccionTemporal.filter((id) => id !== a.id);
      cuantosArtistas();
    });
    textos.append(
      nodo('strong', '', a.nombre),
      nodo('small', '', [a.referencia, a.id].filter(Boolean).join(' · '))
    );
    label.append(check, textos);
    opciones.append(label);
  }
  if (!items.length)
    opciones.append(nodo('p', 'mensaje-vacio', 'Sin resultados. Puedes crear una ficha en Artistas.'));
  cuantosArtistas();
}
function cuantosArtistas() {
  $('cuantos').textContent =
    seleccionTemporal.length + (seleccionTemporal.length === 1 ? ' seleccionado' : ' seleccionados');
  $('aceptar-artistas').disabled = !seleccionTemporal.length;
}
$('aceptar-artistas').onclick = () => {
  ficha.artistaIds = [...seleccionTemporal];
  $('subtitulo-ficha').textContent = nombres(ficha.artistaIds);
  pintarCreditos();
  actualizarPie();
  $('selector').close();
};
$('cerrar-selector').onclick = () => $('selector').close();
$('buscar-artista').addEventListener('input', pintarSelector);
async function guardarFicha() {
  if (!sucio || preparando || guardando) return;
  guardando = true;
  actualizarPie();
  try {
    const esCancion = modo === 'canciones',
      clave = esCancion ? claveCancion(elegido) : claveArtista(elegido);
    const despues = esCancion ? fichaCancion(ficha) : fichaArtista(ficha);
    despues.nombre = despues.nombre.trim();
    if (esCancion) validarCancion(despues, catalogo.artistas);
    const medios = { ...cambioDe(clave)?.medios, ...nuevosMedios };
    const sinCambio = JSON.stringify(despues) === JSON.stringify(baseEdicion);
    const valor = sinCambio
      ? null
      : {
          clave,
          antes: baseEdicion,
          despues,
          medios,
          origen: origenEdicion,
          revision: crypto.randomUUID()
        };
    await cambiarBorradores([{ clave, revision: revisionInicial, valor }]);
    await recargarLocales();
    canal?.postMessage('cambio');
    aviso(
      sinCambio
        ? 'La ficha coincide con el catálogo publicado.'
        : 'Borrador guardado en este dispositivo.'
    );
  } catch (e) {
    aviso(e.message);
  } finally {
    guardando = false;
    actualizarPie();
  }
}
async function descartarFicha(clave) {
  if (guardando || preparando || publicando) return;
  const cambio = cambioDe(clave);
  if (!cambio) return;
  if (!cambio.antes && catalogo.covers.some((c) => c.artistaIds?.includes(cambio.despues.id))) {
    aviso(
      'Este artista está asignado a una canción. Retíralo de sus créditos antes de descartar la ficha.'
    );
    return;
  }
  if (!(await confirmar('Se descartará el borrador de «' + cambio.despues.nombre + '».'))) return;
  try {
    await cambiarBorradores([{ clave, revision: cambio.revision }]);
    if (!cambio.antes) {
      idNuevo = '';
      elegido = null;
      history.replaceState(null, '', '#artistas');
      hashActual = '#artistas';
      document.body.classList.remove('ficha-abierta');
    }
    await recargarLocales();
    canal?.postMessage('cambio');
    aviso('Borrador descartado.');
  } catch (e) {
    aviso(e.message);
  }
}
async function recargarLocales() {
  borradores = await leerBorradores();
  catalogo = aplicarCambios(base, borradores);
  listar();
  editar();
  resumen();
}
function abrirRama() {
  if (sucio || preparando) {
    aviso('Guarda primero el borrador de esta ficha.');
    return;
  }
  $('resultado-rama').replaceChildren();
  $('rama-contexto').textContent = borradores.length
    ? 'Estos cambios se publicarán juntos en grimminck.cl y serán visibles en el reproductor de tus alumnos.'
    : 'Aquí aparecerán los borradores que guardes en este dispositivo.';
  $('resumen-cambios').replaceChildren(
    ...borradores.map((c) =>
      nodo('div', '', (c.clave.startsWith('artista:') ? 'Artista · ' : 'Canción · ') + c.despues.nombre)
    )
  );
  $('publicar-form').hidden = $('descartar-borradores').hidden = !borradores.length;
  $('rama').showModal();
}
$('abrir-rama').onclick = abrirRama;
$('cerrar-rama').onclick = () => {
  if (!publicando) $('rama').close();
};
$('rama').addEventListener('cancel', (e) => {
  if (publicando) e.preventDefault();
});
$('publicar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (publicando || !borradores.length) return;
  const cambios = [...borradores];
  publicando = true;
  $('publicar').disabled = true;
  $('descartar-borradores').disabled = $('cerrar-rama').disabled = true;
  const progreso = (msg) => {
    $('resultado-rama').textContent = msg;
  };
  progreso('Preparando los cambios…');
  try {
    const guardado = await publicarCambios(cambios, progreso);
    base = guardado.catalogo;
    sha = guardado.sha;
    await cambiarBorradores(
      cambios.map((c) => ({ clave: c.clave, revision: c.revision })),
      true
    );
    await recargarLocales();
    canal?.postMessage('rama');
    $('publicar-form').hidden = $('descartar-borradores').hidden = true;
    $('rama-contexto').textContent =
      'Cambios guardados. Aparecerán en el reproductor cuando termine la actualización del sitio.';
    $('resumen-cambios').replaceChildren();
    const enlace = nodo('a', 'enlace', 'Ver cambio en GitHub');
    enlace.href = 'https://github.com/jpgrimminck/play/commit/' + sha;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    $('resultado-rama').replaceChildren(enlace);
  } catch (e) {
    if (e.status === 401) {
      $('rama').close();
      entrar();
    } else progreso(e.message + ' Los borradores siguen disponibles.');
  } finally {
    publicando = false;
    $('publicar').disabled = $('cerrar-rama').disabled = $('descartar-borradores').disabled = false;
  }
});
$('descartar-borradores').onclick = async () => {
  if (
    publicando ||
    !(await confirmar(
      'Se quitarán todos los borradores de este navegador y se volverá a cargar el catálogo publicado.'
    ))
  )
    return;
  try {
    await cambiarBorradores(borradores.map((c) => ({ clave: c.clave, revision: c.revision })));
    await recargarLocales();
    await actualizarRemoto();
    canal?.postMessage('cambio');
    $('rama').close();
    aviso('Borradores descartados.');
  } catch (e) {
    $('resultado-rama').textContent = e.message;
  }
};
$('tab-canciones').onclick = () => ir('#canciones');
$('tab-artistas').onclick = () => ir('#artistas');
$('nuevo').onclick = () => {
  const id = nuevoId();
  if (puedeCrear()) {
    idNuevo = id;
    ir('#artista-' + id);
  }
};
function puedeCrear() {
  return Boolean(catalogo && !guardando && !preparando && !publicando);
}
$('volver').onclick = () => ir('#' + modo);
$('buscar').addEventListener('input', (e) => {
  busquedas[modo] = e.target.value;
  listar();
});
$('filtros').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) {
    filtroTipo = b.dataset.tipo;
    listar();
  }
});
movil.addEventListener('change', () => {
  if (catalogo && !ficha && !movil.matches) {
    listar();
    editar();
  }
});
async function actualizarRemoto() {
  try {
    const remota = await leerCatalogo();
    if (sucio || preparando || publicando || guardando) return;
    if (remota.sha !== sha) {
      base = remota.catalogo;
      sha = remota.sha;
      catalogo = aplicarCambios(base, borradores);
      abrirRuta(hashActual);
    }
    avisoBase('');
  } catch (e) {
    if (e.status === 401) {
      entrar();
      return;
    }
    avisoBase(
      'Se muestra el catálogo del último despliegue. Se comprobará la versión más reciente al publicar.'
    );
  }
}
if (canal)
  canal.onmessage = async (e) => {
    if (!base || !catalogo) return;
    if (sucio || preparando || publicando || guardando) {
      aviso('Hay cambios en otra pestaña. Tus cambios siguen en la ficha.');
      return;
    }
    try {
      await recargarLocales();
      if (e.data === 'rama') await actualizarRemoto();
    } catch (err) {
      aviso(err.message);
    }
  };
async function iniciar() {
  try {
    const [respuesta, version, locales] = await Promise.all([
      fetch('/json/covers.json', { cache: 'no-cache' }),
      fetch('/admin/version.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      leerBorradores()
    ]);
    if (!respuesta.ok) throw new Error();
    base = await respuesta.json();
    borradores = locales;
    shaCompilado = version.sha || '';
    sha = shaCompilado;
    catalogo = aplicarCambios(base, borradores);
    $('trabajo').hidden = false;
    $('abrir-rama').disabled = false;
    abrirRuta(location.hash);
    if (location.protocol === 'https:') actualizarRemoto();
  } catch {
    $('resumen').textContent = 'No se pudo abrir el catálogo.';
    avisoBase('Comprueba la conexión y que el navegador permita guardar datos de este sitio.');
    $('error-inicial').append(boton('Reintentar', 'boton-texto', iniciar));
  }
}
const entrar = accesoDelEditor(() => {
  if (catalogo) actualizarRemoto();
  else iniciar();
});
$('salir').addEventListener('click', async () => {
  if (!(await puedeSalir())) return;
  try {
    await api('/api/song-upload/session', { method: 'DELETE' });
    window.google?.accounts?.id?.disableAutoSelect();
    sucio = false;
    location.reload();
  } catch (e) {
    aviso(e.message);
  }
});
entrar();
