import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, sessionUser, cookie, cookieValue, SESSION_COOKIE, NONCE_COOKIE, SESSION_SECONDS, requireSameOrigin, loginNonce } from '../server/upload-session.js';
import handler from '../api/song-upload/session.js';
const secret = 'test-session-secret-with-more-than-32-characters';
const user = {sub:'google-owner-id', email:'grimminck@gmail.com', name:'Juan Pablo'};
const now = new Date('2026-11-19T15:00:00Z');
function response() {
  return {headers:{},code:0,body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
}
test('a signed session works after closing the page, without a Google credential', async () => {
  const token = await createSession(user, secret, now);
  assert.deepEqual(await sessionUser(token, secret, user.email, new Date(now.getTime()+29*86400000)),user);
  await assert.rejects(sessionUser(token, secret, user.email, new Date(now.getTime()+31*86400000)),{status:401});
});
test('expired, changed, foreign and newly unauthorized sessions are rejected', async () => {
  const token=await createSession(user,secret,now);
  const [h,p,s]=token.split('.');
  const changed=Buffer.from(JSON.stringify({email:'attacker@gmail.com',sub:user.sub})).toString('base64url');
  await assert.rejects(sessionUser(`${h}.${changed}.${s}`,secret,user.email,now),{status:401});
  await assert.rejects(sessionUser(token,'a different secret',user.email,now),{status:401});
  await assert.rejects(sessionUser(token,secret,'different-owner@gmail.com',now),{status:403});
  await assert.rejects(sessionUser('',secret,user.email,now),{status:401});
});
test('persistent cookies are host-only, HttpOnly, Secure and SameSite Strict', () => {
  const header=cookie(SESSION_COOKIE,'signed-value',SESSION_SECONDS);
  assert.ok(header.startsWith('__Host-'));assert.ok(header.includes('HttpOnly'));assert.ok(header.includes('Secure'));assert.ok(header.includes('SameSite=Strict'));
  assert.ok(header.includes('Max-Age=2592000'));assert.ok(!header.includes('Domain='));
  assert.equal(cookieValue({headers:{cookie:`other=1; ${SESSION_COOKIE}=signed-value`}},SESSION_COOKIE),'signed-value');
});
test('login nonce is random and is bound to a short-lived protected cookie', () => {
  const a=response(),b=response();const first=loginNonce(a),second=loginNonce(b);
  assert.notEqual(first,second);assert.equal(first.length,43);
  assert.ok(a.headers['Set-Cookie'].startsWith(`${NONCE_COOKIE}=${first}`));assert.ok(a.headers['Set-Cookie'].includes('Max-Age=900'));
});
test('cross-origin mutations cannot use a remembered session', () => {
  requireSameOrigin({headers:{host:'www.grimminck.cl',origin:'https://www.grimminck.cl'}});
  assert.throws(()=>requireSameOrigin({headers:{host:'www.grimminck.cl',origin:'https://evil.example'}}),{status:403});
  assert.throws(()=>requireSameOrigin({headers:{host:'www.grimminck.cl'}}),{status:403});
});
test('session endpoint restores and renews access; logout expires cookies', async t => {
  const required=['GOOGLE_CLIENT_ID','SONG_UPLOAD_GITHUB_TOKEN','SONG_UPLOAD_SECRET','BLOB_READ_WRITE_TOKEN','SONG_UPLOAD_OWNER_EMAIL'];
  const old={...process.env};t.after(()=>{for(const k of required){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}});
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'test-client',SONG_UPLOAD_GITHUB_TOKEN:'test-github',SONG_UPLOAD_SECRET:secret,BLOB_READ_WRITE_TOKEN:'test-blob',SONG_UPLOAD_OWNER_EMAIL:user.email});
  const token=await createSession(user,secret);
  const restored=response();
  await handler({method:'GET',headers:{cookie:`${SESSION_COOKIE}=${token}`}},restored);
  assert.equal(restored.code,200);assert.deepEqual(restored.body.user,user);assert.ok(restored.headers['Set-Cookie'][0].includes('Max-Age=2592000'));
  const loggedOut=response();await handler({method:'DELETE',headers:{host:'www.grimminck.cl',origin:'https://www.grimminck.cl'}},loggedOut);
  assert.equal(loggedOut.code,200);assert.equal(loggedOut.body.user,null);assert.ok(loggedOut.headers['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
  const empty=response();await handler({method:'GET',headers:{}},empty);assert.equal(empty.body.user,null);
  const tampered=response();await handler({method:'GET',headers:{cookie:`${SESSION_COOKIE}=fake`}},tampered);assert.equal(tampered.body.user,null);assert.ok(tampered.headers['Set-Cookie'].includes('Max-Age=0'));
  const forbidden=response();await handler({method:'DELETE',headers:{host:'www.grimminck.cl',origin:'https://evil.example'}},forbidden);assert.equal(forbidden.code,403);assert.equal(forbidden.headers['Set-Cookie'],undefined);
});
