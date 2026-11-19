import { configuration, route } from '../../server/song-upload.js';
import { loginNonce } from '../../server/upload-session.js';
export default route('GET', async (req, res) => ({ ...configuration(), nonce: loginNonce(res) }));
