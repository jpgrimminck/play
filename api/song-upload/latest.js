import { authenticateRequest, catalogAtHead, route } from '../../server/song-upload.js';
export default route('GET', async req => {
  await authenticateRequest(req);
  const { catalog, sha } = await catalogAtHead();
  const song = [...catalog.covers].sort((a,b) => b.id - a.id)[0] || null;
  // The largest historical ID is the catalog order; there were no upload timestamps before this feature.
  return { song, sha, artistas: catalog.artistas || [] };
});
