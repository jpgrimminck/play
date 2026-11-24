import { del } from '@vercel/blob';
import { authenticateRequest, checkTicket, catalogAtHead, github, postGithub, route, REPO, BRANCH } from '../../server/song-upload.js';
import { appendSong, metadata, HttpError } from '../../server/upload-core.js';
import { readMedia } from '../../server/staged-media.js';
export const config = { maxDuration: 300 };
export default route('POST', async req => {
  const user = await authenticateRequest(req);
  const ticket = checkTicket(req.body?.ticket, user);
  if (ticket.purpose) throw new HttpError(400, 'Esta autorización corresponde al editor de canciones.');
  if (!Array.isArray(req.body?.artistaIds))
    throw new HttpError(400, 'Selecciona los artistas de la lista.');
  const meta = metadata(req.body);
  const snapshot = await catalogAtHead();
  const next = appendSong(snapshot.catalog, meta, ticket.id);
  const response = sha => ({ song: next.song, commit: `https://github.com/${REPO}/commit/${sha}`, player: `https://grimminck.cl/?song=${next.song.id}`, state: 'saved', message: 'Guardada en GitHub. Esperando que el alojamiento publique el cambio.' });
  if (next.existing) return response(snapshot.sha);
  const audio = await readMedia(req.body.audioUrl, ticket, 'audio');
  const cover = await readMedia(req.body.coverUrl, ticket, 'cover');
  const id = next.song.id;
  const treeInfo = await github(`git/trees/${snapshot.tree}?recursive=1`);
  if (treeInfo.truncated) throw new HttpError(500, 'No se pudo comprobar el catálogo completo.');
  if (treeInfo.tree.some(f => f.path === `songs/${id}.mp3` || f.path === `covers/cover${id}.jpeg`)) throw new HttpError(409, 'Ya existen archivos para el siguiente ID. Revisa el catálogo antes de subir.');
  const audioBlob = await postGithub('git/blobs', { content: audio.toString('base64'), encoding: 'base64' });
  const coverBlob = await postGithub('git/blobs', { content: cover.toString('base64'), encoding: 'base64' });
  const tree = await postGithub('git/trees', { base_tree: snapshot.tree, tree: [
    { path: `songs/${id}.mp3`, mode: '100644', type: 'blob', sha: audioBlob.sha },
    { path: `covers/cover${id}.jpeg`, mode: '100644', type: 'blob', sha: coverBlob.sha },
    { path: 'json/covers.json', mode: '100644', type: 'blob', content: JSON.stringify(next.catalog, null, 2) + '\n' },
  ] });
  const commit = await postGithub('git/commits', { message: `Agregar canción ${id}: ${meta.nombre}`, tree: tree.sha, parents: [snapshot.sha] });
  // GitHub refuses non-fast-forward updates. A concurrent publish cannot overwrite another song.
  await github(`git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  await Promise.allSettled([del(req.body.audioUrl), del(req.body.coverUrl)]);
  return response(commit.sha);
});
