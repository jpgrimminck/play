import { authenticate, bearer, route, ticketFor } from '../../server/song-upload.js';
export default route('POST', async req => ticketFor(await authenticate(bearer(req))));
