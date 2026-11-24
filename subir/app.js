import { upload } from '@vercel/blob/client';
import { coincidenciasArtistas, seleccionValida } from './artistas.js';
const $ = id => document.getElementById(id);
let coverBlob = null, audioFile = null, audioReady = false, busy = false, pending = null;
let photoVersion = 0, audioVersion = 0, coverObjectUrl = '', audioObjectUrl = '';
let artists = [], selected = [], addingArtist = false;
const status = message => { $('status').textContent = message; };
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/song-upload/${path}`, { method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json().catch(() => ({ error: 'El servidor no pudo responder. Vuelve a intentar.' }));
  if (!response.ok) {
    if (response.status === 401) { $('workspace').hidden = true; $('login').hidden = false; }
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}


function renderLatest(song, sha) {
  const audio = $('latest-audio');
  audio.pause(); $('latest-play').disabled = true; $('latest-seek').disabled = true; $('latest-seek').value = 0;
  $('latest-status').textContent = song ? '' : 'Sin canciones';
  if (!song) {
    $('latest-image').hidden = true; $('latest-title').textContent = ''; $('latest-artist').textContent = '';
    audio.removeAttribute('src'); audio.load(); return;
  }
  const base = 'https://raw.githubusercontent.com/jpgrimminck/play/' + sha;
  $('latest-image').src = base + '/covers/cover' + song.id + '.jpeg';
  $('latest-image').alt = 'Carátula de ' + song.nombre; $('latest-image').hidden = false;
  $('latest-title').textContent = song.nombre; $('latest-artist').textContent = song.artista;
  audio.src = base + '/songs/' + song.id + '.mp3';
  audio.onloadedmetadata = () => {
    const ready = Number.isFinite(audio.duration) && audio.duration > 0;
    $('latest-play').disabled = !ready; $('latest-seek').disabled = !ready;
  };
  audio.onerror = () => { $('latest-status').textContent = 'No se pudo cargar el audio.'; $('latest-play').disabled = true; $('latest-seek').disabled = true; };
  audio.load();
}
async function refreshLatest() {
  try { const data = await api('latest'); renderLatest(data.song, data.sha); }
  catch (e) { $('latest-status').textContent = e.message; }
}
function syncLatest() {
  const paused = $('latest-audio').paused;
  $('latest-play-icon').setAttribute('d', paused ? 'm8 5 11 7-11 7z' : 'M6 5h4v14H6zM14 5h4v14h-4z');
  $('latest-play').setAttribute('aria-label', paused ? 'Reproducir último single' : 'Pausar último single');
}
$('latest-play').onclick = async () => {
  const audio = $('latest-audio');
  if (audio.paused) {
    try { $('preview-audio').pause(); await audio.play(); }
    catch { $('latest-status').textContent = 'No se pudo reproducir el audio.'; }
  } else audio.pause();
};
for (const event of ['play','pause','ended']) $('latest-audio').addEventListener(event,syncLatest);
$('preview-audio').addEventListener('play', () => $('latest-audio').pause());
$('latest-audio').addEventListener('timeupdate', () => {
  if (Number.isFinite($('latest-audio').duration) && $('latest-audio').duration > 0)
    $('latest-seek').value = 100 * $('latest-audio').currentTime / $('latest-audio').duration;
});
$('latest-seek').oninput = () => {
  if (Number.isFinite($('latest-audio').duration) && $('latest-audio').duration > 0)
    $('latest-audio').currentTime = $('latest-audio').duration * Number($('latest-seek').value) / 100;
};

async function loadArtists() {
  $('fields').disabled = true; $('publish').disabled = true;
  try {
    const data = await api('latest');
    if (!Array.isArray(data.artistas)) throw new Error('No se pudieron cargar los artistas. Recarga la página.');
    artists = data.artistas;
    renderLatest(data.song, data.sha);
    renderArtists();
    $('fields').disabled = false; $('publish').disabled = false;
  } catch (e) { status(e.message); }
}
function renderArtists() {
  const root = $('artists'); root.replaceChildren();
  for (const id of selected) {
    const artist = artists.find(a => a.id === id);
    const chip = document.createElement('div'); chip.className = 'artist-chip';
    const name = document.createElement('span'); name.className = 'artist-name';
    name.textContent = artist?.nombre || id; name.title = [artist?.referencia, id].filter(Boolean).join(' · ');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-artist';
    remove.textContent = '×'; remove.setAttribute('aria-label', 'Quitar ' + name.textContent);
    remove.onclick = () => { selected = selected.filter(value => value !== id); addingArtist = false; clearPending(); renderArtists(); };
    chip.append(name, remove); root.append(chip);
  }
  if (selected.length === 3) return;
  if (selected.length && !addingArtist) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'add-artist'; add.textContent = '+';
    add.setAttribute('aria-label', selected.length === 1 ? 'Agregar segundo artista' : 'Agregar tercer artista');
    add.onclick = () => { addingArtist = true; renderArtists(); root.querySelector('.artist-search')?.focus(); };
    root.append(add);
    return;
  }
  const slot = document.createElement('div'); slot.className = 'artist-slot';
  const input = document.createElement('input'); input.className = 'artist-search';
  input.placeholder = selected.length ? '+ Artista' : 'Artista';
  input.setAttribute('aria-label', selected.length ? 'Agregar artista' : 'Elegir artista');
  input.autocomplete = 'off';
  input.required = !selected.length;
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-expanded','false'); input.setAttribute('aria-controls','artist-results');
  const results = document.createElement('div'); results.id = 'artist-results';
  results.className = 'artist-results'; results.setAttribute('role','listbox'); results.hidden = true;
  function search() {
    results.replaceChildren(); results.hidden = false; input.setAttribute('aria-expanded','true');
    for (const a of coincidenciasArtistas(artists, selected, input.value)) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'artist-option';
      option.setAttribute('role','option'); option.textContent = a.nombre;
      const detail = document.createElement('small'); detail.textContent = [a.referencia,a.id].filter(Boolean).join(' · ');
      option.append(detail);
      option.onclick = () => {
        selected.push(a.id); addingArtist = false; clearPending(); renderArtists();
        (root.querySelector('.add-artist') || $('type')).focus();
      };
      option.onkeydown = e => {
        if(e.key === 'ArrowDown') { e.preventDefault(); (option.nextElementSibling || results.firstElementChild).focus(); }
        if(e.key === 'ArrowUp') { e.preventDefault(); (option.previousElementSibling || input).focus(); }
        if(e.key === 'Escape') { results.hidden = true; input.focus(); input.setAttribute('aria-expanded','false'); }
      };
      results.append(option);
    }
    if (!results.childElementCount) {
      const empty = document.createElement('p'); empty.className = 'artist-empty'; empty.textContent = 'Sin coincidencias'; results.append(empty);
    }
  }
  input.oninput = () => { input.setCustomValidity(input.value.trim() ? 'Selecciona un artista de la lista.' : ''); clearPending(); search(); };
  input.onfocus = search;
  input.onkeydown = e => {
    if(e.key === 'ArrowDown') { e.preventDefault(); results.querySelector('button')?.focus(); }
    if(e.key === 'Enter') { e.preventDefault(); results.querySelector('button')?.focus(); }
    if(e.key === 'Escape') { results.hidden = true; input.setAttribute('aria-expanded','false'); }
  };
  slot.onfocusout = () => setTimeout(() => {
    if (!slot.contains(document.activeElement)) { results.hidden = true; input.setAttribute('aria-expanded','false'); }
  }, 0);
  slot.append(input,results); root.append(slot);
}
async function signIn(response) {
  try {
    await api('session', { method:'POST', body:{credential:response.credential} });
    $('login').hidden = true; $('workspace').hidden = false; status('');
    await loadArtists();
  } catch(e) { status(e.message); }
}
function clearPending() { pending = null; $('confirmed').checked = false; $('result').replaceChildren(); }
$('title').addEventListener('input', clearPending);
$('type').addEventListener('change', clearPending);
function syncAudio() {
  $('play').disabled = !audioReady;
  $('seek').disabled = !audioReady;
  $('audio-label').textContent = audioFile ? 'Cambiar audio' : 'Subir audio';
  $('play-icon').setAttribute('d', $('preview-audio').paused ? 'm8 5 11 7-11 7z' : 'M6 5h4v14H6zM14 5h4v14h-4z');
  $('play').setAttribute('aria-label', $('preview-audio').paused ? 'Reproducir audio' : 'Pausar audio');
}
$('play').onclick = async () => {
  const audio = $('preview-audio');
  if (!audioReady) return;
  if (audio.paused) { try { await audio.play(); } catch { status('No se pudo reproducir el audio.'); } }
  else audio.pause();
};
for (const event of ['play','pause','ended']) $('preview-audio').addEventListener(event,syncAudio);
$('preview-audio').addEventListener('timeupdate', () => {
  $('seek').value = audioReady ? 100 * $('preview-audio').currentTime / $('preview-audio').duration : 0;
});
$('seek').oninput = () => {
  if(audioReady) $('preview-audio').currentTime = $('preview-audio').duration * Number($('seek').value) / 100;
};
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
  $('preview-audio').pause(); $('preview-audio').removeAttribute('src'); $('preview-audio').hidden = true; syncAudio();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  const file = $('audio').files[0]; if (!file) return;
  if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 30*1024*1024) { $('audio').value = ''; status('Elige un MP3 de hasta 30 MB.'); return; }
  audioFile = file; audioObjectUrl = URL.createObjectURL(file);
  $('preview-audio').src = audioObjectUrl; $('preview-audio').hidden = false; syncAudio();
  $('preview-audio').onloadedmetadata = () => { if (version === audioVersion) { audioReady = Number.isFinite($('preview-audio').duration) && $('preview-audio').duration > 0; syncAudio(); } };
  $('preview-audio').onerror = () => { if (version === audioVersion) { audioReady = false; syncAudio(); status('El navegador no pudo leer ese MP3. Exporta el audio nuevamente.'); } };
  $('preview-audio').load(); status('');
});
$('song-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!seleccionValida(artists,selected)) { status('Selecciona entre uno y tres artistas de la lista.'); return; }
  if (!coverBlob || !audioFile || !audioReady) { status('Espera a que se preparen la carátula y el audio. Debes poder escucharlo en la vista previa.'); return; }
  if (!$('song-form').reportValidity()) return;
  busy = true; $('fields').disabled = true; $('publish').disabled = true; $('progress').hidden = false; status('');
  try {
    if (!pending) pending = await api('prepare', { method: 'POST' });
    const options = { access: 'private', handleUploadUrl: '/api/song-upload/blob', clientPayload: JSON.stringify({ ticket: pending.ticket }), multipart: true };
    if (!pending.coverUrl) {
      $('result').textContent = 'Subiendo carátula…';
      pending.coverUrl = (await upload(`song-staging/${pending.uploadId}/cover.jpeg`, coverBlob, { ...options, contentType: 'image/jpeg', onUploadProgress: ({ percentage }) => { $('progress').value = percentage * .1; } })).url;
    }
    if (!pending.audioUrl) {
      $('result').textContent = 'Subiendo audio…';
      pending.audioUrl = (await upload(`song-staging/${pending.uploadId}/audio.mp3`, audioFile, { ...options, contentType: 'audio/mpeg', onUploadProgress: ({ percentage }) => { $('progress').value = 10 + percentage * .75; } })).url;
    }
    $('progress').value = 90; $('result').textContent = 'Guardando la canción completa en GitHub…';
    const saved = await api('publish', { method: 'POST', body: { ticket: pending.ticket, coverUrl: pending.coverUrl, audioUrl: pending.audioUrl, nombre: $('title').value, artistaIds: [...selected], tipo: $('type').value } });
    $('progress').value = 100; $('result').replaceChildren();
    const message = document.createElement('p'); message.textContent = 'Canción subida.';
    const link = document.createElement('a'); link.href = saved.player; link.textContent = 'Abrir canción'; link.target = '_blank'; link.rel = 'noopener';
    $('result').append(message, link);
    photoVersion++; audioVersion++;
    $('song-form').reset(); pending = null; coverBlob = null; audioFile = null; audioReady = false;
    $('preview-audio').pause(); $('preview-audio').removeAttribute('src'); $('preview-audio').load(); $('preview-audio').hidden = true; syncAudio();
    $('preview-image').hidden = true; $('artwork').classList.add('empty'); selected = []; addingArtist = false; renderArtists(); $('seek').value = 0;
    await refreshLatest();
    if(coverObjectUrl) URL.revokeObjectURL(coverObjectUrl); if(audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);

  } catch (e) { status(`${e.message} Tus archivos siguen seleccionados para reintentar.`); $('result').textContent = 'No se confirmó una nueva publicación. Puedes reintentar; una subida ya guardada no se duplicará.'; }
  finally { busy = false; $('fields').disabled = false; $('publish').disabled = false; }
});
async function initialize() {
  try {
    const { user } = await api('session');
    if (user) {
      $('login').hidden = true; $('workspace').hidden = false; status('');
      await loadArtists();
      return;
    }
    $('login').hidden = false;
    const config = await api('config');
    if (!config.ready) { status('Esta página está preparada. Falta activar Google y la conexión privada de subida en el alojamiento.'); return; }
    const start = Date.now();
    while (!window.google?.accounts?.id) { if (Date.now() - start > 15000) throw new Error('No se pudo cargar Google. Revisa tu conexión y recarga la página.'); await new Promise(r => setTimeout(r,100)); }
    window.google.accounts.id.initialize({ client_id: config.clientId, nonce: config.nonce, callback: signIn, auto_select: false });
    window.google.accounts.id.renderButton($('google-button'), { type:'standard', theme:'outline', size:'large', text:'signin_with', locale:'es' });
  } catch(e) { status(e.message); }
}
initialize();
