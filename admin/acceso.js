import { api } from './repositorio.js';
const $ = (id) => document.getElementById(id);
let biblioteca;
function cargarGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!biblioteca)
    biblioteca = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        biblioteca = null;
        script.remove();
        reject(new Error('No se pudo cargar el acceso de Google.'));
      };
      document.head.append(script);
    });
  return biblioteca;
}
export function accesoDelEditor(alEntrar) {
  const estado = (texto) => {
    $('estado-acceso').textContent = texto;
  };
  function mostrarEditor() {
    $('acceso').hidden = true;
    $('acciones-admin').hidden = false;
    $('principal').hidden = false;
    alEntrar();
  }
  async function iniciar() {
    $('principal').hidden = true;
    $('acciones-admin').hidden = true;
    $('acceso').hidden = false;
    $('google-admin').replaceChildren();
    $('reintentar-acceso').hidden = true;
    estado('Comprobando tu sesión…');
    try {
      const { user } = await api('/api/song-upload/session');
      if (user) {
        mostrarEditor();
        return;
      }
      const config = await api('/api/song-upload/config');
      if (!config.ready)
        throw new Error('El acceso al administrador requiere que esté activa la conexión de subida.');
      await cargarGoogle();
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        nonce: config.nonce,
        auto_select: false,
        callback: async ({ credential }) => {
          try {
            estado('Verificando tu cuenta…');
            await api('/api/song-upload/session', { method: 'POST', body: { credential } });
            mostrarEditor();
          } catch (e) {
            estado(e.message);
            $('reintentar-acceso').hidden = false;
          }
        }
      });
      window.google.accounts.id.renderButton($('google-admin'), {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'es'
      });
      estado('');
    } catch (e) {
      estado(e.message);
      $('reintentar-acceso').hidden = false;
    }
  }
  $('reintentar-acceso').addEventListener('click', iniciar);
  return iniciar;
}
