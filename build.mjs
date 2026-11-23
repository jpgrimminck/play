import { cp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { prepararCatalogo } from './catalogo-datos.js';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/subir', { recursive: true });
const dirs = new Set(['admin','admin-songs','covers','docs','drums','html','icons','json','songs','usuarios']);
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (dirs.has(entry.name)) await cp(entry.name, `dist/${entry.name}`, { recursive: true, filter: p => !p.split('/').includes('supabase') });
  else if (entry.isFile() && /\.(html|css|js|json)$/.test(entry.name) && !['package.json','package-lock.json','vercel.json'].includes(entry.name)) await cp(entry.name, `dist/${entry.name}`);
}
await cp('subir/index.html', 'dist/subir/index.html');
await cp('subir/style.css', 'dist/subir/style.css');
await build({ entryPoints: ['admin/app.js'], outfile: 'dist/admin/app.js', bundle: true, format: 'esm', minify: true, target: ['es2022'] });
await build({ entryPoints: ['subir/app.js'], outfile: 'dist/subir/app.js', bundle: true, format: 'esm', minify: true, target: ['es2022'] });

// Pin the admin's fallback snapshot to its deployment, including while a later commit is building.
let sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!sha) {
  try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
}
await writeFile('dist/admin/version.json', JSON.stringify({ sha }));

// WhatsApp reads the initial HTML before the catalog JavaScript runs.
const portada = await readFile('index.html', 'utf8');
const datos = JSON.parse(await readFile('json/covers.json', 'utf8'));
const origen = 'https://www.grimminck.cl';
await mkdir('dist/cancion', { recursive: true });
for (const { id, nombre } of prepararCatalogo(datos.covers, datos.artistas)) {
  const titulo = nombre.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const url = origen + '/cancion/' + id;
  const imagen = '/cancion/' + id + '.jpg';
  await sharp('covers/cover' + id + '.jpeg').rotate()
    .resize(600, 600, { fit: 'contain', background: '#090d16' })
    .jpeg({ quality: 82 }).toFile('dist' + imagen);
  // A nonempty, visually blank description keeps the card free of extra copy.
  const metadatos = [
    '<title>' + titulo + '</title>',
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="music.song">',
    '<meta property="og:title" content="' + titulo + '">',
    '<meta property="og:description" content="&#8203;">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:image" content="' + origen + imagen + '">',
    '<meta property="og:image:type" content="image/jpeg">',
    '<meta property="og:image:width" content="600">',
    '<meta property="og:image:height" content="600">'
  ].join('\n  ');
  const pagina = portada.replace(/ *<meta name="description"[^>]*>\n/, '')
    .replace(/<title>[^<]*<\/title>/, () => metadatos);
  await writeFile('dist/cancion/' + id + '.html', pagina);
}
