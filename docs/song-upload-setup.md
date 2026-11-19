# Subida exclusiva de canciones

Página: `/subir`. Se integra en el proyecto Vercel del reproductor sin reemplazar su pantalla principal. Preparada para activar; requiere configuración externa y una prueba completa antes de usarla.

## Activación

1. Confirmar que el proyecto Vercel conectado a `jpgrimminck/play`, rama `production`, sirve `grimminck.cl`. El archivo `vercel.json` no prueba por sí solo la conexión del dominio.
2. En Google Cloud Console crear o reutilizar un cliente OAuth **Aplicación web** para Google Identity Services. Configurar el consentimiento y añadir los orígenes JavaScript `https://grimminck.cl` y `https://www.grimminck.cl` si se usa. Añadir también el origen exacto de prueba. Se usa callback del botón, sin redirect URI.
3. Definir estas variables en Vercel Production:

| Variable | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID público del cliente web de Google |
| `SONG_UPLOAD_OWNER_EMAIL` | `grimminck@gmail.com`; confirmar que esta es la cuenta que JP autoriza |
| `SONG_UPLOAD_GITHUB_TOKEN` | Token fine-grained limitado a `jpgrimminck/play`, permiso **Contents: Read and write** |
| `SONG_UPLOAD_SECRET` | Secreto aleatorio de al menos 32 caracteres; generar con `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | Lo añade Vercel al conectar un Blob store privado al proyecto |

Si las reglas de `production` bloquean escritura directa, usar una identidad autorizada por esas reglas. No desactivar las protecciones para probar. Guardar los secretos únicamente en el alojamiento.

4. Crear un **Vercel Blob privado** en ese mismo proyecto. Es un área temporal para MP3 grandes; la copia definitiva queda en GitHub. Revisar las tarifas y el consumo del servicio antes de activarlo.
5. `npm ci`, `npm test`, `npm run build`. Vercel debe usar framework **Other**, salida `dist` y funciones `api/`, definidos en `vercel.json`. El build conserva las páginas y medios del reproductor y empaqueta el SDK de subida. Nunca poner tokens privados en archivos públicos o en el chat.
6. Desplegar y probar con la cuenta autorizada y otra cuenta (debe rechazarse). Comprobar una publicación real, su commit y el despliegue de Vercel. Para pruebas de escritura usar una copia con destino de pruebas: el código fija explícitamente `jpgrimminck/play:production`. No poner las credenciales de producción en Preview.

## Archivos guardados

Una publicación asigna el siguiente ID y guarda en un **único commit**:

- `songs/ID.mp3`: MP3 original, hasta 30 MiB.
- `covers/coverID.jpeg`: carátula de 1024 × 1024, recortada al centro y convertida en JPEG en el navegador.
- `json/covers.json`: añade `id`, `nombre`, `artista`, `tipo`, `uploadedAt`, `uploadId`; actualiza `totalCovers`.

No añade letras, ritmos ni secciones ficticias. El reproductor ya utiliza esas rutas. La última canción se obtiene de GitHub y sus medios se leen desde el SHA exacto, aunque Vercel todavía esté desplegando. Para las canciones antiguas, “última” significa el ID mayor del catálogo: no existen fechas históricas de subida confiables.

## Protección y recuperación

El servidor verifica la firma RSA de Google, emisor, audiencia, vencimiento y correo verificado. El mensaje exclusivo solo aparece después de esta comprobación. La credencial permanece en memoria de la página. Cada subida tiene una autorización firmada, vinculada al usuario y válida una hora; solo permite dos rutas temporales concretas. El servidor comprueba tipo, tamaño, ruta y firma inicial de archivo. El navegador exige un MP3 reproducible; no se realiza decodificación completa de audio en servidor.

El catálogo se lee desde un SHA consistente. Se detectan IDs duplicados, huecos, totales incorrectos y archivos existentes antes de escribir. La actualización del ref usa `force: false`: dos publicaciones simultáneas no pueden sobrescribirse. El `uploadId` impide duplicar una subida ya guardada si se repite la petición.

El éxito significa **guardado en GitHub**, no despliegue confirmado. El dominio se actualiza después del despliegue automático del alojamiento. Comprobar ese resultado en Vercel.

Los temporales se borran después de confirmar el commit. Si se abandona una subida o falla la limpieza, pueden quedar archivos en `song-staging/`. Revisar y borrar periódicamente temporales de más de 24 horas desde Vercel Blob. No se ha creado una limpieza automática ni modificado la facturación.

Si vence la autorización de subida, recargar y seleccionar nuevamente los archivos. Ante un fallo ambiguo de red, reintentar antes de recargar para conservar el mismo `uploadId`.

Las pruebas locales no acreditan el recorrido externo de Google, Blob, permisos de GitHub y despliegue. Ese recorrido requiere configurar las credenciales y realizar una prueba real.

## Referencias

- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://vercel.com/docs/vercel-blob/client-upload
- https://docs.github.com/en/rest/git/refs#update-a-reference
