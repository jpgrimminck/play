import { authenticate, authenticateRequest, route } from '../../server/song-upload.js';
import { cookie, cookieValue, createSession, SESSION_COOKIE, NONCE_COOKIE, SESSION_SECONDS, requireSameOrigin } from '../../server/upload-session.js';
export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  if (req.method === 'DELETE') {
    requireSameOrigin(req);
    res.setHeader('Set-Cookie', [cookie(SESSION_COOKIE, '', 0), cookie(NONCE_COOKIE, '', 0)]);
    return { user: null };
  }
  if (req.method === 'GET' && !cookieValue(req, SESSION_COOKIE)) return { user: null };
  let user;
  if (req.method === 'POST') {
    requireSameOrigin(req);
    user = await authenticate(req.body?.credential, cookieValue(req, NONCE_COOKIE));
  } else {
    try { user = await authenticateRequest(req); }
    catch(error) {
      if (error.status !== 401 && error.status !== 403) throw error;
      res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
      return { user: null };
    }
  }
  const token = await createSession(user, process.env.SONG_UPLOAD_SECRET);
  const cookies = [cookie(SESSION_COOKIE, token, SESSION_SECONDS)];
  if (req.method === 'POST') cookies.push(cookie(NONCE_COOKIE, '', 0));
  res.setHeader('Set-Cookie', cookies);
  return { user };
});
