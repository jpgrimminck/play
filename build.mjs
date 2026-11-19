import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/subir', { recursive: true });
const dirs = new Set(['admin-songs','covers','docs','drums','html','icons','json','songs','usuarios']);
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (dirs.has(entry.name)) await cp(entry.name, `dist/${entry.name}`, { recursive: true, filter: p => !p.split('/').includes('supabase') });
  else if (entry.isFile() && /\.(html|css|js|json)$/.test(entry.name) && !['package.json','package-lock.json','vercel.json'].includes(entry.name)) await cp(entry.name, `dist/${entry.name}`);
}
await cp('subir/index.html', 'dist/subir/index.html');
await cp('subir/style.css', 'dist/subir/style.css');
await build({ entryPoints: ['subir/app.js'], outfile: 'dist/subir/app.js', bundle: true, format: 'esm', minify: true, target: ['es2022'] });
