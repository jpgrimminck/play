const MiB = 1024 * 1024;

async function huella(blob) {
  const cabecera = new TextEncoder().encode('blob ' + blob.size + '\0');
  const bytes = await new Blob([cabecera, blob]).arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return Array.from(hash, (n) => n.toString(16).padStart(2, '0')).join('');
}

export async function prepararCaratula(archivo) {
  if (!archivo.size || archivo.size > 20 * MiB) throw new Error('Elige una imagen de hasta 20 MiB.');
  const b = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
  const texto = new TextDecoder().decode(b);
  const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  const png = b[0] === 137 && texto.slice(1, 4) === 'PNG';
  const webp = texto.startsWith('RIFF') && texto.endsWith('WEBP');
  if (!jpeg && !png && !webp) throw new Error('Elige una imagen JPG, PNG o WebP.');
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode().catch(() => {
      throw new Error('La imagen no se pudo abrir.');
    });
    const ancho = imagen.naturalWidth,
      alto = imagen.naturalHeight;
    if (!ancho || !alto || ancho * alto > 24_000_000)
      throw new Error('Elige una imagen de hasta 24 megapíxeles.');
    let blob = archivo;
    if (!jpeg) {
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;
      const contexto = lienzo.getContext('2d');
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, ancho, alto);
      contexto.drawImage(imagen, 0, 0);
      blob = await new Promise((resolve) => lienzo.toBlob(resolve, 'image/jpeg', 0.94));
      if (!blob) throw new Error('No se pudo preparar la imagen en este dispositivo.');
    }
    if (blob.size > 20 * MiB) throw new Error('La carátula en JPEG supera los 20 MiB. Reduce sus dimensiones.');
    return { blob, meta: { formato: 'JPEG', bytes: blob.size, ancho, alto, sha: await huella(blob) } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function comprobarAudio(archivo) {
  const url = URL.createObjectURL(archivo);
  const audio = new Audio();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fin(false), 15000);
      function fin(ok) {
        clearTimeout(timer);
        audio.onloadedmetadata = audio.onerror = null;
        if (ok) resolve();
        else
          reject(
            new Error('El navegador no pudo leer este MP3. Comprueba el archivo y vuelve a elegirlo.')
          );
      }
      audio.onloadedmetadata = () => fin(Number.isFinite(audio.duration) && audio.duration > 0);
      audio.onerror = () => fin(false);
      audio.preload = 'metadata';
      audio.src = url;
    });
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepararAudio(archivo) {
  if (!archivo.size || archivo.size > 30 * MiB) throw new Error('Elige un audio MP3 de hasta 30 MiB.');
  const b = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
  const id3 = new TextDecoder().decode(b.slice(0, 3)) === 'ID3';
  const trama = b[0] === 255 && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) === 0x02;
  if (!id3 && !trama) throw new Error('El archivo debe ser un MP3.');
  await comprobarAudio(archivo);
  return { blob: archivo, meta: { formato: 'MP3', bytes: archivo.size, sha: await huella(archivo) } };
}

export async function medirArchivo(url, clase, registrado = {}) {
  // A range normally gives both the signature and the full byte count without downloading the track.
  const res = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  if (!res.ok) throw new Error('No se pudo leer el archivo.');
  const total =
    res.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ||
    (res.status === 200 ? res.headers.get('content-length') : null);
  const lector = res.body.getReader();
  let prefijo;
  try {
    ({ value: prefijo } = await lector.read());
  } finally {
    await lector.cancel().catch(() => {});
  }
  const p = prefijo || new Uint8Array(),
    t = new TextDecoder().decode(p.slice(0, 16));
  let formato = 'Desconocido';
  if (p[0] === 255 && p[1] === 216 && p[2] === 255) formato = 'JPEG';
  else if (t.slice(1, 4) === 'PNG') formato = 'PNG';
  else if (t.startsWith('RIFF')) formato = t.slice(8, 12) === 'WEBP' ? 'WebP' : 'WAV';
  else if (t.slice(4, 8) === 'ftyp')
    formato =
      registrado.formato?.startsWith('MP4') && Number(total) === registrado.bytes
        ? registrado.formato
        : 'MP4';
  else if (t.startsWith('ID3') || (p[0] === 255 && (p[1] & 0xe0) === 0xe0)) formato = 'MP3';
  else if (t.startsWith('fLaC')) formato = 'FLAC';
  else if (t.startsWith('OggS')) formato = 'Ogg';
  const meta = { formato, bytes: Number(total) || registrado.bytes };
  if (!meta.bytes) {
    const completa = await fetch(url);
    if (!completa.ok) throw new Error('No se pudo leer el tamaño.');
    meta.bytes = (await completa.blob()).size;
  }
  if (clase === 'caratula') {
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode();
    meta.ancho = imagen.naturalWidth;
    meta.alto = imagen.naturalHeight;
  }
  return meta;
}
