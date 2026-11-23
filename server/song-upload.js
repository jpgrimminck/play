import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cookieValue, SESSION_COOKIE, sessionUser, requireSameOrigin } from './upload-session.js';
import { randomUUID } from 'node:crypto';
import { HttpError, ownerClaims, readTicket, signTicket } from './upload-core.js';
export const REPO = 'jpgrimminck/play';
export const BRANCH = 'production';
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function configuration() {
  return { clientId: process.env.GOOGLE_CLIENT_ID || '', ready: ['GOOGLE_CLIENT_ID','SONG_UPLOAD_GITHUB_TOKEN','SONG_UPLOAD_SECRET','BLOB_READ_WRITE_TOKEN'].every(k => !!process.env[k]) && process.env.SONG_UPLOAD_SECRET.length >= 32 };
}
export async function authenticate(token, expectedNonce) {
  if (!configuration().ready) throw new HttpError(503, 'Falta configurar el acceso de Google y la conexión de subida.');
  if (typeof token !== 'string' || token.length > 8192) throw new HttpError(401, 'Ingresa con Google para continuar.');
  let payload;
  try { ({ payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], issuer: ['accounts.google.com','https://accounts.google.com'], audience: process.env.GOOGLE_CLIENT_ID, maxTokenAge: '1h', requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified'] })); }
  catch { throw new HttpError(401, 'Tu sesión venció. Vuelve a ingresar con Google.'); }
  if (expectedNonce !== undefined && (!expectedNonce || payload.nonce !== expectedNonce)) throw new HttpError(401, 'Recarga la página y vuelve a ingresar con Google.');
  return ownerClaims(payload, process.env.SONG_UPLOAD_OWNER_EMAIL || 'grimminck@gmail.com');
}
export async function authenticateRequest(req) {
  if (req.method === 'POST' && process.env.VERCEL_ENV === 'preview') {
    throw new HttpError(403, 'La carga de canciones está desactivada en la vista de prueba.');
  }
  if (!configuration().ready) throw new HttpError(503, 'Falta configurar el acceso de Google y la conexión de subida.');
  if (!['GET','HEAD'].includes(req.method)) requireSameOrigin(req);
  return sessionUser(cookieValue(req, SESSION_COOKIE), process.env.SONG_UPLOAD_SECRET, process.env.SONG_UPLOAD_OWNER_EMAIL || 'grimminck@gmail.com');
}
export function ticketFor(user, purpose) { const data = { ...(purpose ? { purpose } : {}), id: randomUUID(), sub: user.sub, exp: Date.now() + 3600000 }; return { ticket: signTicket(data, process.env.SONG_UPLOAD_SECRET), uploadId: data.id }; }
export function checkTicket(ticket, user) { return readTicket(ticket, process.env.SONG_UPLOAD_SECRET, user.sub); }
export async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.SONG_UPLOAD_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new HttpError(response.status === 422 || response.status === 409 ? 409 : 502, response.status === 422 || response.status === 409 ? 'El catálogo cambió durante la subida. Presiona publicar para reintentar.' : 'GitHub no pudo completar el cambio. Revisa los permisos de la conexión.');
  return response.json();
}
export const postGithub = (path, body) => github(path, { method: 'POST', body: JSON.stringify(body) });
export async function catalogAtHead() {
  const ref = await github(`git/ref/heads/${BRANCH}`);
  const commit = await github(`git/commits/${ref.object.sha}`);
  const file = await github(`contents/json/covers.json?ref=${ref.object.sha}`);
  return { sha: ref.object.sha, tree: commit.tree.sha, catalog: JSON.parse(Buffer.from(file.content, 'base64').toString()) };
}
export function route(method, action) { return async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const methods = Array.isArray(method) ? method : [method];
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return res.status(405).json({ error: 'Método no permitido.' }); }
  try { return res.status(200).json(await action(req, res)); }
  catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo completar la operación. Puedes reintentar.' }); }
}; }
