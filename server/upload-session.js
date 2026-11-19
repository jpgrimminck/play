import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { HttpError, ownerClaims } from './upload-core.js';
export const SESSION_COOKIE = '__Host-grimminck_song_session';
export const NONCE_COOKIE = '__Host-grimminck_song_login';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const issuer = 'grimminck-song-session';
const audience = 'grimminck-song-upload';
export function cookieValue(req, name) {
  const part = (req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}
export function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`;
}
export function requireSameOrigin(req) {
  if (!req.headers?.host || req.headers.origin !== `https://${req.headers.host}`) throw new HttpError(403, 'Abre la página de GrimmInck para continuar.');
}
export function loginNonce(res) {
  const nonce = randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', cookie(NONCE_COOKIE, nonce, 15 * 60));
  return nonce;
}
export async function createSession(user, secret, now = new Date()) {
  return new SignJWT({ email: user.email, email_verified: true })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer).setAudience(audience).setSubject(user.sub)
    .setIssuedAt(Math.floor(now.getTime()/1000))
    .setExpirationTime(Math.floor(now.getTime()/1000) + SESSION_SECONDS)
    .sign(Buffer.from(secret));
}
export async function sessionUser(token, secret, owner, now = new Date()) {
  if (!token || token.length > 4096) throw new HttpError(401, 'Ingresa con Google para continuar.');
  let payload;
  try {
    ({ payload } = await jwtVerify(token, Buffer.from(secret), {
      algorithms: ['HS256'], issuer, audience, currentDate: now, maxTokenAge: '30d',
      requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified'],
    }));
  } catch { throw new HttpError(401, 'Tu sesión venció. Vuelve a ingresar con Google.'); }
  return ownerClaims(payload, owner);
}
