import { configuration, route } from '../../server/song-upload.js';
export default route('GET', async () => configuration());
