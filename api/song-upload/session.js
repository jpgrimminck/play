import { authenticate, bearer, route } from '../../server/song-upload.js';
export default route('POST', async req => ({ user: await authenticate(bearer(req)) }));
