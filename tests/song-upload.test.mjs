import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSong, ownerClaims, signTicket, readTicket, metadata, uploadPath, validMedia } from '../server/upload-core.js';
import { configuration, github, route } from '../server/song-upload.js';
const catalog = { totalCovers: 2, covers: [{ id:1, nombre:'Uno', artista:'JP', tipo:'i' }, { id:2, nombre:'Dos', artista:'JP', tipo:'c' }], extra: true };
const secret = 'test-secret-with-at-least-32-characters';
const data = { id:'8d86d7e2-5b6e-4f38-aa56-e573d3ef666a', sub:'google-user-1', exp:2000 };
test('only the verified owner is authorized', () => {
  assert.equal(ownerClaims({ sub:'1', email:'grimminck@gmail.com', email_verified:true }, 'grimminck@gmail.com').name, 'Juan Pablo');
  for (const claims of [{ sub:'1', email:'other@gmail.com', email_verified:true }, { sub:'1', email:'grimminck@gmail.com', email_verified:false }, { email:'grimminck@gmail.com', email_verified:true }]) assert.throws(() => ownerClaims(claims, 'grimminck@gmail.com'), { status:403 });
});
test('upload tickets are bound to identity and expire', () => {
  const ticket = signTicket(data, secret);
  assert.deepEqual(readTicket(ticket, secret, data.sub, 1000), data);
  assert.throws(() => readTicket(ticket, secret, 'another-user', 1000));
  assert.throws(() => readTicket(ticket, secret, data.sub, 3000));
  assert.throws(() => readTicket(ticket + '.extra', secret, data.sub, 1000));
  assert.throws(() => readTicket(ticket.replace(/^./, 'x'), secret, data.sub, 1000));
  assert.throws(() => readTicket(ticket, 'other-secret', data.sub, 1000));
});
test('paths cannot come from a client filename', () => {
  assert.equal(uploadPath(data, 'audio'), `song-staging/${data.id}/audio.mp3`);
  assert.equal(uploadPath(data, 'cover'), `song-staging/${data.id}/cover.jpeg`);
});
test('catalog append preserves old data and player numbering', () => {
  const result = appendSong(catalog, { nombre:'Tres', artista:'Alumno', tipo:'c' }, data.id, '2026-11-19T15:00:00Z');
  assert.equal(result.song.id,3); assert.equal(result.catalog.totalCovers,3);
  assert.deepEqual(result.catalog.covers.slice(0,2),catalog.covers);
  assert.equal(result.catalog.extra,true); assert.equal(catalog.totalCovers,2);
});
test('retrying an already saved upload does not create another song', () => {
  const first = appendSong(catalog, { nombre:'Tres', artista:'JP', tipo:'i' }, data.id);
  const retry = appendSong(first.catalog, { nombre:'Tres', artista:'JP', tipo:'i' }, data.id);
  assert.equal(retry.existing,true); assert.equal(retry.catalog.covers.length,3); assert.equal(retry.song.id,3);
});
test('inconsistent or duplicate IDs cannot silently overwrite files', () => {
  for (const invalid of [{ totalCovers:2,covers:[{id:1},{id:1}] },{totalCovers:3,covers:[{id:1},{id:3}]},{totalCovers:5,covers:[{id:1}]},{totalCovers:1,covers:[{id:'1'}]}]) assert.throws(() => appendSong(invalid,{},data.id));
});
test('metadata is validated before publishing', () => {
  assert.deepEqual(metadata({nombre:' Tres ',artista:' JP ',tipo:'i'}),{nombre:'Tres',artista:'JP',tipo:'i'});
  for(const input of [{},{nombre:'x',artista:'x',tipo:'invalid'},{nombre:'x'.repeat(161),artista:'x',tipo:'c'}]) assert.throws(() => metadata(input),{status:400});
});
test('file signatures reject disguised files', () => {
  assert.equal(validMedia(Buffer.from([255,216,255,224]),'cover'),true);
  assert.equal(validMedia(Buffer.from('ID3abcdef'),'audio'),true);
  assert.equal(validMedia(Buffer.from([255,251,144,100]),'audio'),true);
  assert.equal(validMedia(Buffer.from('<html>fake.mp3'),'audio'),false);
  assert.equal(validMedia(Buffer.from('not a jpeg'),'cover'),false);
});
test('public configuration never exposes private credentials', t => {
  const old = { ...process.env };
  t.after(() => { for(const k of ['GOOGLE_CLIENT_ID','SONG_UPLOAD_GITHUB_TOKEN','SONG_UPLOAD_SECRET','BLOB_READ_WRITE_TOKEN']) { if(old[k] === undefined) delete process.env[k]; else process.env[k]=old[k]; } });
  process.env.GOOGLE_CLIENT_ID='public-id';process.env.SONG_UPLOAD_GITHUB_TOKEN='private-github';process.env.SONG_UPLOAD_SECRET=secret;process.env.BLOB_READ_WRITE_TOKEN='private-blob';
  assert.deepEqual(configuration(),{clientId:'public-id',ready:true});
  delete process.env.SONG_UPLOAD_GITHUB_TOKEN; assert.equal(configuration().ready,false);
});
test('GitHub ref updates reject conflicts without exposing response secrets', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let seen;
  globalThis.fetch = async (url, options) => { seen = {url,options}; return new Response('{"message":"sensitive upstream details"}',{status:422}); };
  await assert.rejects(github('git/refs/heads/production',{method:'PATCH',body:JSON.stringify({sha:'new',force:false})}),e=>e.status===409 && !e.message.includes('sensitive'));
  assert.equal(JSON.parse(seen.options.body).force,false);
});
test('API wrapper rejects writes on GET and disables caching', async () => {
  const headers={}; let statusCode,body;
  const res={setHeader:(k,v)=>headers[k]=v,status:c=>{statusCode=c;return res;},json:b=>{body=b;return res;}};
  let called=false;
  await route('POST',async()=>{called=true;})({method:'GET'},res);
  assert.equal(statusCode,405);assert.equal(called,false);assert.equal(headers['Cache-Control'],'no-store');assert.ok(body.error);
});
test('Google JWT verification checks signature, audience, expiry and owner', async t => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { authenticate } = await import('../server/song-upload.js');
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid:'test-google-key', alg:'RS256', use:'sig' };
  const originalFetch=globalThis.fetch, originalEnv={...process.env};
  t.after(()=>{globalThis.fetch=originalFetch;for(const k of ['GOOGLE_CLIENT_ID','SONG_UPLOAD_GITHUB_TOKEN','SONG_UPLOAD_SECRET','BLOB_READ_WRITE_TOKEN','SONG_UPLOAD_OWNER_EMAIL']){if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}});
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'test-google-client',SONG_UPLOAD_GITHUB_TOKEN:'test-token',SONG_UPLOAD_SECRET:secret,BLOB_READ_WRITE_TOKEN:'test-blob',SONG_UPLOAD_OWNER_EMAIL:'grimminck@gmail.com'});
  globalThis.fetch=async url=>{assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});};
  const token=async ({email='grimminck@gmail.com',audience='test-google-client',expiry='1h'}={})=>new SignJWT({email,email_verified:true}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://accounts.google.com').setAudience(audience).setSubject('google-user').setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  assert.equal((await authenticate(await token())).email,'grimminck@gmail.com');
  await assert.rejects(authenticate(await token({email:'someone@gmail.com'})),{status:403});
  await assert.rejects(authenticate(await token({audience:'wrong-client'})),{status:401});
  await assert.rejects(authenticate(await token({expiry:'-1h'})),{status:401});
  const signed=await token();const parts=signed.split('.');parts[1]=Buffer.from(JSON.stringify({email:'someone@gmail.com'})).toString('base64url');
  await assert.rejects(authenticate(parts.join('.')),{status:401});
});
