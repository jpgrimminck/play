import { authenticateRequest, route, ticketFor } from '../../server/song-upload.js';
export default route('POST', async req => ticketFor(await authenticateRequest(req)));
