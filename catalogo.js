import { prepararCatalogo, cancionesDelAlumno, cancionVecina, opcionesAlumnos, resolverAlumno } from './catalogo-datos.js';

const el = id => document.getElementById(id);
const audio = el('audio');
const player = el('player');
const filtro = el('filterDialog');
const urlCaratula = id => '/covers/cover' + id + '.jpeg';
const urlAudio = id => '/songs/' + id + '.mp3';
let catalogo = [];
let alumnos = [];
let alumno = '';
let cola = [];
let actual = null;
let mostrarAccesoAlPlayer = false;
let intentosPlay = 0;

function reloj(segundos) {
  if (!Number.isFinite(segundos)) return '–:––';
  return Math.floor(segundos / 60) + ':' + String(Math.floor(segundos % 60)).padStart(2, '0');
}

function enlaceCancion(cancion) {
  const direccion = new URL('/', location.origin);
  direccion.searchParams.set('song', cancion.id);
  return direccion;
}

function tarjeta(cancion, destacada) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'card ' + (destacada ? 'feature' : 'tile');
  boton.dataset.song = cancion.id;
  boton.setAttribute('aria-label', 'Reproducir ' + cancion.nombre + ', ' + cancion.artista);
  const foto = new Image();
  foto.alt = '';
  foto.loading = 'lazy';
  foto.decoding = 'async';
  foto.width = foto.height = 220;
  foto.src = urlCaratula(cancion.id);
  const texto = document.createElement('span');
  texto.className = 'card-text';
  const nombre = document.createElement('span');
  nombre.className = 'card-title';
  nombre.textContent = cancion.nombre;
  const artista = document.createElement('span');
  artista.className = 'card-artist';
  artista.textContent = cancion.artista;
  texto.append(nombre, artista);
  boton.append(texto, foto);
  return boton;
}

function dibujarFiltro() {
  el('studentOptions').replaceChildren(...[{ id: '', etiqueta: 'Todos' }, ...alumnos].map(({ id, etiqueta }) => {
    const opcion = document.createElement('button');
    opcion.type = 'button';
    opcion.dataset.alumno = id;
    opcion.textContent = etiqueta;
    opcion.setAttribute('aria-pressed', String(id === alumno));
    return opcion;
  }));
}

function dibujarCatalogo(nombre) {
  alumno = resolverAlumno(nombre, alumnos);
  cola = cancionesDelAlumno(catalogo, alumno);
  const [destacada, ...resto] = cola;
  el('heroTitle').textContent = destacada.nombre;
  el('heroArtist').textContent = destacada.artista;
  el('heroCover').src = urlCaratula(destacada.id);
  el('heroArt').setAttribute('aria-label', 'Abrir reproductor de ' + destacada.nombre);
  el('heroNotice').textContent = '';
  el('filterName').textContent = alumnos.find(a => a.id === alumno)?.etiqueta || 'Todos';
  el('recentGrid').replaceChildren(...resto.slice(0, 3).map(cancion => tarjeta(cancion, true)));
  el('coverGrid').replaceChildren(...resto.slice(3).map(cancion => tarjeta(cancion, false)));
  el('catalog').hidden = resto.length === 0;
  el('hero').hidden = el('dock').hidden = false;
  if (!actual || !cola.some(cancion => cancion.id === actual.id)) {
    mostrarAccesoAlPlayer = false;
    seleccionar(destacada);
  }
  dibujarFiltro();
  sincronizar();
}

function seleccionar(cancion) {
  if (actual?.id === cancion.id) return;
  intentosPlay++;
  audio.pause();
  actual = cancion;
  audio.src = urlAudio(cancion.id);
  audio.load();
  el('playerCover').src = urlCaratula(cancion.id);
  el('playerTitle').textContent = cancion.nombre;
  el('playerArtist').textContent = cancion.artista;
  el('nowTitle').textContent = cancion.nombre;
  el('nowPlaying').setAttribute('aria-label', 'Abrir reproductor de ' + cancion.nombre);
  el('playerNotice').textContent = el('heroNotice').textContent = '';
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cancion.nombre, artist: cancion.artista, album: 'Grimminck Music',
      artwork: [{src: urlCaratula(cancion.id), type: 'image/jpeg'}]
    });
  }
  sincronizar();
}

function progreso(rango, tiempo, duracion, activo) {
  const habilitado = activo && Number.isFinite(audio.duration) && audio.duration > 0;
  const posicion = activo ? audio.currentTime : 0;
  rango.disabled = !habilitado;
  rango.max = habilitado ? audio.duration : 1;
  rango.value = habilitado ? posicion : 0;
  rango.style.setProperty('--pos', (habilitado ? 100 * posicion / audio.duration : 0) + '%');
  tiempo.textContent = reloj(posicion || 0);
  duracion.textContent = habilitado ? reloj(audio.duration) : '–:––';
  rango.setAttribute('aria-valuetext', habilitado ? reloj(posicion) + ' de ' + reloj(audio.duration) : '0:00');
}

function actualizarTiempo() {
  progreso(el('playerSeek'), el('playerTime'), el('playerDuration'), Boolean(actual));
  progreso(el('heroSeek'), el('heroTime'), el('heroDuration'), actual?.id === cola[0]?.id);
}

function sincronizar() {
  if (!actual) return;
  const sonando = !audio.paused && !audio.ended && !audio.error;
  const destacadoSonando = sonando && actual.id === cola[0]?.id;
  el('heroPlay').textContent = destacadoSonando ? 'Pausa' : 'Play';
  el('heroPlay').setAttribute('aria-label', (destacadoSonando ? 'Pausar ' : 'Reproducir ') + cola[0].nombre);
  el('playerPlay').setAttribute('aria-label', sonando ? 'Pausar' : 'Reproducir');
  el('playIcon').setAttribute('href', sonando ? '#i-pause' : '#i-play');
  el('nowPlaying').hidden = !mostrarAccesoAlPlayer || player.open || actual.id === cola[0].id;
  el('previous').disabled = el('next').disabled = cola.length < 2;
  for (const tarjeta of document.querySelectorAll('.card.playing')) tarjeta.classList.remove('playing');
  if (sonando) document.querySelector('[data-song="' + actual.id + '"]')?.classList.add('playing');
  actualizarTiempo();
}

function errorAudio() {
  const mensaje = 'No se pudo reproducir el audio. Toca Play para reintentar.';
  el('playerNotice').textContent = mensaje;
  if (actual?.id === cola[0]?.id) el('heroNotice').textContent = mensaje;
  sincronizar();
}

async function reproducir() {
  const intento = ++intentosPlay;
  mostrarAccesoAlPlayer = true;
  el('playerNotice').textContent = el('heroNotice').textContent = '';
  if (audio.error) audio.load();
  try {
    await audio.play();
  } catch (error) {
    if (intento === intentosPlay && error.name !== 'AbortError') errorAudio();
  }
}

function alternar() {
  if (audio.paused || audio.ended) reproducir();
  else { intentosPlay++; audio.pause(); }
}

function actualizarDireccion(metodo, conCancion, abiertaDesdeCatalogo) {
  const url = new URL(location.href);
  if (alumno) url.searchParams.set('alumno', alumno);
  else url.searchParams.delete('alumno');
  if (conCancion) url.searchParams.set('song', actual.id);
  else url.searchParams.delete('song');
  history[metodo]({ ...history.state, reproductorDesdeCatalogo: abiertaDesdeCatalogo }, '', url);
}

function abrirPlayer(cancion, escuchar) {
  seleccionar(cancion);
  if (!player.open) {
    player.showModal();
    actualizarDireccion('pushState', true, true);
  } else {
    actualizarDireccion('replaceState', true, Boolean(history.state?.reproductorDesdeCatalogo));
  }
  mostrarAccesoAlPlayer = true;
  sincronizar();
  if (escuchar) reproducir();
}

function cerrarPlayer() {
  if (history.state?.reproductorDesdeCatalogo) {
    history.back();
  } else {
    player.close();
    actualizarDireccion('replaceState', false, false);
  }
}

function restaurarDireccion() {
  const params = new URLSearchParams(location.search);
  const pedida = catalogo.find(cancion => cancion.id === Number(params.get('song')));
  let filtroUrl = resolverAlumno(params.get('alumno'), alumnos, pedida);
  if (pedida && !pedida.alumnos.includes(filtroUrl)) filtroUrl = '';
  if (!actual || filtroUrl !== alumno) dibujarCatalogo(filtroUrl);
  if (pedida) {
    seleccionar(pedida);
    if (!player.open) player.showModal();
    mostrarAccesoAlPlayer = true;
  } else if (player.open) {
    player.close();
  }
  sincronizar();
}

function avanzar(paso) {
  const siguiente = cancionVecina(cola, actual?.id, paso);
  if (!siguiente) return;
  seleccionar(siguiente);
  if (player.open) actualizarDireccion('replaceState', true, Boolean(history.state?.reproductorDesdeCatalogo));
  reproducir();
}

async function compartir(cancion, aviso) {
  const url = enlaceCancion(cancion).href;
  aviso.textContent = '';
  if (navigator.share) {
    try { await navigator.share({ title: cancion.nombre + ' · ' + cancion.artista, url }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    aviso.textContent = 'Enlace copiado.';
  } catch {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.textContent = url;
    aviso.replaceChildren('Enlace de la canción: ', enlace);
  }
}

function abrirFiltro() {
  filtro.showModal();
  filtro.querySelector('[aria-pressed="true"]').focus();
}
el('openFilter').addEventListener('click', abrirFiltro);
el('closeFilter').addEventListener('click', () => filtro.close());
el('studentOptions').addEventListener('click', event => {
  const opcion = event.target.closest('button[data-alumno]');
  if (!opcion) return;
  filtro.close();
  dibujarCatalogo(opcion.dataset.alumno);
  actualizarDireccion('replaceState', false, false);
  window.scrollTo(0, 0);
});
for (const dialogo of [filtro, player]) {
  dialogo.addEventListener('click', event => {
    if (event.target !== dialogo) return;
    const rect = dialogo.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
    if (dialogo === player) cerrarPlayer();
    else filtro.close();
  });
}
el('catalog').addEventListener('click', event => {
  const tarjeta = event.target.closest('button[data-song]');
  if (tarjeta) abrirPlayer(cola.find(cancion => cancion.id === Number(tarjeta.dataset.song)), true);
});
el('heroArt').addEventListener('click', () => abrirPlayer(cola[0], true));
el('heroPlay').addEventListener('click', () => { seleccionar(cola[0]); alternar(); });
el('nowPlaying').addEventListener('click', () => abrirPlayer(actual, false));
el('playerPlay').addEventListener('click', alternar);
el('closePlayer').addEventListener('click', cerrarPlayer);
player.addEventListener('cancel', event => { event.preventDefault(); cerrarPlayer(); });
player.addEventListener('close', sincronizar);
el('previous').addEventListener('click', () => avanzar(-1));
el('next').addEventListener('click', () => avanzar(1));
el('heroShare').addEventListener('click', () => compartir(cola[0], el('heroNotice')));
el('playerShare').addEventListener('click', () => compartir(actual, el('playerNotice')));
for (const id of ['heroSeek', 'playerSeek']) {
  el(id).addEventListener('input', event => {
    if (Number.isFinite(audio.duration)) { audio.currentTime = Number(event.target.value); actualizarTiempo(); }
  });
}
for (const evento of ['play','playing','pause','loadedmetadata','durationchange','emptied']) audio.addEventListener(evento, sincronizar);
audio.addEventListener('timeupdate', actualizarTiempo);
audio.addEventListener('error', errorAudio);
audio.addEventListener('ended', () => { if (cola.length > 1) avanzar(1); else sincronizar(); });
window.addEventListener('popstate', () => { if (catalogo.length) restaurarDireccion(); });

async function cargar() {
  const estado = el('catalogStatus');
  estado.hidden = false;
  estado.textContent = 'Cargando canciones…';
  el('retry').hidden = true;
  try {
    const respuesta = await fetch('/json/covers.json', { cache: 'no-cache' });
    if (!respuesta.ok) throw new Error('catalogo');
    const datos = await respuesta.json();
    catalogo = prepararCatalogo(datos.covers, datos.artistas);
    if (!catalogo.length) { estado.textContent = 'Todavía no hay canciones en el catálogo.'; return; }
    alumnos = opcionesAlumnos(catalogo, datos.artistas || []);
    restaurarDireccion();
    estado.hidden = true;
  } catch {
    estado.textContent = 'No se pudo cargar el catálogo.';
    el('retry').hidden = false;
  }
}
el('retry').addEventListener('click', cargar);
cargar();
