import { upload } from '@vercel/blob/client';
const $ = id => document.getElementById(id);
let credential = '', coverBlob = null, audioFile = null, audioReady = false, busy = false, pending = null;
let photoVersion = 0, audioVersion = 0, coverObjectUrl = '', audioObjectUrl = '';
const status = message => { $('status').textContent = message; };
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/song-upload/${path}`, { method, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json().catch(() => ({ error: 'El servidor no pudo responder. Vuelve a intentar.' }));
  if (!response.ok) {
    if (response.status === 401) { credential = ''; $('workspace').hidden = true; $('login').hidden = false; }
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}
function renderLatest(song, root, assetBase = '', cache = '') {
  root.replaceChildren();
  if (!song) { root.textContent = 'Todavía no hay canciones.'; return; }
  const img = document.createElement('img'); img.src = `${assetBase}/covers/cover${song.id}.jpeg${cache}`; img.alt = `Carátula de ${song.nombre}`;
  const title = document.createElement('h3'); title.textContent = song.nombre;
  const artist = document.createElement('p'); artist.className = 'muted'; artist.textContent = song.artista;
  const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = `${assetBase}/songs/${song.id}.mp3${cache}`;
  const link = document.createElement('a'); link.href = `/?song=${song.id}`; link.textContent = 'Ver en el reproductor';
  root.append(img, title, artist, audio, link);
}
async function latest() {
  $('refresh').disabled = true;
  try { const { song, sha } = await api('latest');
    // Read current GitHub assets, even while the production deployment is catching up.
    renderLatest(song, $('latest-content'), `https://raw.githubusercontent.com/jpgrimminck/play/${sha}`);
  } catch (e) { $('latest-content').textContent = e.message; }
  finally { $('refresh').disabled = false; }
}
async function signIn(response) {
  credential = response.credential;
  try {
    const { user } = await api('session', { method: 'POST' });
    $('account').textContent = user.email;
    $('login').hidden = true; $('workspace').hidden = false; status('');
    await latest();
  } catch (e) { credential = ''; status(e.message); }
}
function clearPending() { pending = null; $('confirmed').checked = false; $('result').replaceChildren(); }
$('title').addEventListener('input', () => { $('preview-title').textContent = $('title').value || 'Nombre de la canción'; clearPending(); });
$('artist').addEventListener('input', () => { $('preview-artist').textContent = $('artist').value || 'Artista o alumno'; clearPending(); });
$('type').addEventListener('change', clearPending);
$('photo').addEventListener('change', async () => {
  const version = ++photoVersion; clearPending(); coverBlob = null;
  if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
  $('preview-image').hidden = true; $('artwork').classList.add('empty');
  const file = $('photo').files[0]; if (!file) return;
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Elige una imagen JPG, PNG o WebP de hasta 20 MB.');
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image(); image.src = sourceUrl;
    try {
      await image.decode();
      if (version !== photoVersion) return;
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      if (!side) throw new Error('La imagen no se pudo leer.');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0,0,1024,1024);
      context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0,0,1024,1024);
      const converted = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
      if (version !== photoVersion) return;
      if (!converted) throw new Error('No se pudo preparar la carátula.');
      coverBlob = converted; coverObjectUrl = URL.createObjectURL(converted);
      $('preview-image').src = coverObjectUrl; $('preview-image').hidden = false; $('artwork').classList.remove('empty'); status('');
    } finally { URL.revokeObjectURL(sourceUrl); }
  } catch (e) { if (version === photoVersion) { $('photo').value = ''; status(e.message); } }
});
$('audio').addEventListener('change', () => {
  const version = ++audioVersion; clearPending(); audioFile = null; audioReady = false;
  $('preview-audio').pause(); $('preview-audio').removeAttribute('src'); $('preview-audio').hidden = true; $('audio-help').hidden = false;
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  const file = $('audio').files[0]; if (!file) return;
  if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 30*1024*1024) { $('audio').value = ''; status('Elige un MP3 de hasta 30 MB.'); return; }
  audioFile = file; audioObjectUrl = URL.createObjectURL(file);
  $('preview-audio').src = audioObjectUrl; $('preview-audio').hidden = false; $('audio-help').hidden = true;
  $('preview-audio').onloadedmetadata = () => { if (version === audioVersion) audioReady = Number.isFinite($('preview-audio').duration) && $('preview-audio').duration > 0; };
  $('preview-audio').onerror = () => { if (version === audioVersion) { audioReady = false; status('El navegador no pudo leer ese MP3. Exporta el audio nuevamente.'); } };
  $('preview-audio').load(); status('');
});
for (const id of ['preview-audio']) $(id).addEventListener('play', () => { document.querySelectorAll('audio').forEach(a => { if(a !== $(id)) a.pause(); }); });
document.addEventListener('play', event => { if (event.target.tagName === 'AUDIO') document.querySelectorAll('audio').forEach(a => { if (a !== event.target) a.pause(); }); }, true);
$('refresh').addEventListener('click', latest);
$('logout').addEventListener('click', () => {
  if (busy) return;
  credential = ''; pending = null; document.querySelectorAll('audio').forEach(a => a.pause());
  $('workspace').hidden = true; $('login').hidden = false; status('');
  window.google?.accounts.id.disableAutoSelect();
});
$('song-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!coverBlob || !audioFile || !audioReady) { status('Espera a que se preparen la carátula y el audio. Debes poder escucharlo en la vista previa.'); return; }
  if (!$('song-form').reportValidity()) return;
  busy = true; $('fields').disabled = true; $('publish').disabled = true; $('logout').disabled = true; $('progress').hidden = false; status('');
  try {
    if (!pending) pending = await api('prepare', { method: 'POST' });
    const options = { access: 'private', handleUploadUrl: '/api/song-upload/blob', clientPayload: JSON.stringify({ credential, ticket: pending.ticket }), multipart: true };
    if (!pending.coverUrl) {
      $('result').textContent = 'Subiendo carátula…';
      pending.coverUrl = (await upload(`song-staging/${pending.uploadId}/cover.jpeg`, coverBlob, { ...options, contentType: 'image/jpeg', onUploadProgress: ({ percentage }) => { $('progress').value = percentage * .1; } })).url;
    }
    if (!pending.audioUrl) {
      $('result').textContent = 'Subiendo audio…';
      pending.audioUrl = (await upload(`song-staging/${pending.uploadId}/audio.mp3`, audioFile, { ...options, contentType: 'audio/mpeg', onUploadProgress: ({ percentage }) => { $('progress').value = 10 + percentage * .75; } })).url;
    }
    $('progress').value = 90; $('result').textContent = 'Guardando la canción completa en GitHub…';
    const saved = await api('publish', { method: 'POST', body: { ticket: pending.ticket, coverUrl: pending.coverUrl, audioUrl: pending.audioUrl, nombre: $('title').value, artista: $('artist').value, tipo: $('type').value } });
    $('progress').value = 100; $('result').replaceChildren();
    const message = document.createElement('p'); message.textContent = `“${saved.song.nombre}” quedó guardada en GitHub. Esperando que grimminck.cl publique el cambio.`;
    const link = document.createElement('a'); link.href = saved.player; link.textContent = 'Abrir canción'; link.target = '_blank'; link.rel = 'noopener';
    const commit = document.createElement('a'); commit.href = saved.commit; commit.textContent = 'Ver cambio en GitHub'; commit.target = '_blank'; commit.rel = 'noopener';
    $('result').append(message, link, commit);
    $('song-form').reset(); pending = null; coverBlob = null; audioFile = null; audioReady = false;
    $('preview-audio').pause(); $('preview-audio').removeAttribute('src'); $('preview-audio').load(); $('preview-audio').hidden = true; $('audio-help').hidden = false;
    $('preview-image').hidden = true; $('artwork').classList.add('empty'); $('preview-title').textContent = 'Nombre de la canción'; $('preview-artist').textContent = 'Artista o alumno';
    if(coverObjectUrl) URL.revokeObjectURL(coverObjectUrl); if(audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    await latest();
  } catch (e) { status(`${e.message} Tus archivos siguen seleccionados para reintentar.`); $('result').textContent = 'No se confirmó una nueva publicación. Puedes reintentar; una subida ya guardada no se duplicará.'; }
  finally { busy = false; $('fields').disabled = false; $('publish').disabled = false; $('logout').disabled = false; }
});
async function initialize() {
  try {
    const config = await api('config');
    if (!config.ready) { status('Esta página está preparada. Falta activar Google y la conexión privada de subida en el alojamiento.'); return; }
    const start = Date.now();
    while (!window.google?.accounts?.id) { if (Date.now() - start > 15000) throw new Error('No se pudo cargar Google. Revisa tu conexión y recarga la página.'); await new Promise(r => setTimeout(r,100)); }
    window.google.accounts.id.initialize({ client_id: config.clientId, callback: signIn, auto_select: false });
    window.google.accounts.id.renderButton($('google-button'), { type:'standard', theme:'outline', size:'large', text:'signin_with', locale:'es' });
  } catch(e) { status(e.message); }
}
initialize();
