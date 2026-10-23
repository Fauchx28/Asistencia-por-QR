# Publicar Asistencia QR en internet (con HTTPS)

Los celulares solo permiten usar la cámara en sitios con **https**, así que para que los docentes escaneen desde su teléfono
la app tiene que estar publicada con un dominio seguro. Además necesita un **disco persistente**: ahí viven la base de datos
y las copias de seguridad. Sin disco persistente, cada reinicio del servidor borra toda la información.

## Opción recomendada: Railway

Railway publica directamente desde tu repositorio de GitHub, da HTTPS automático y permite agregar un volumen (disco persistente).

**Costo (octubre de 2026):** el plan Hobby cuesta 5 USD al mes e incluye 5 USD de uso; los volúmenes cuestan 0,15 USD por GB al mes
(hasta 5 GB en Hobby). Para un colegio, la app cabe de sobra en ese uso. El plan gratuito tiene volúmenes de solo 0,5 GB y un crédito
mensual muy pequeño, así que sirve para probar pero no para el día a día. Revisa los precios actuales en https://railway.com/pricing.

### Pasos

1. Crea una cuenta en https://railway.com con tu usuario de GitHub.
2. **New Project → Deploy from GitHub repo** y elige `Asistencia-por-QR`. Railway detecta el `Dockerfile` y construye la app.
3. **Agrega el volumen:** en el servicio, *Settings → Volumes* (o clic derecho en el servicio → *Attach Volume*) con la ruta de montaje **`/data`**.
4. **Genera el dominio:** *Settings → Networking → Generate Domain*. Te dará algo como `asistencia-qr-production.up.railway.app`.
5. **Variables** (*Variables → Raw Editor*), cambiando los valores entre corchetes:

   ```
   TRUST_PROXY=true
   COOKIE_SECURE=true
   APP_URL=https://[tu-dominio].up.railway.app
   APP_TIMEZONE=America/Bogota
   ADMIN_EMAILS=[tu-correo]
   ORG_NAME=[nombre de quien administra la plataforma]
   PRIVACY_CONTACT=[correo para temas de datos personales]
   REGISTRATION_CODE=[código que compartirás solo con tus docentes]
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=[tu-correo@gmail.com]
   SMTP_PASS=[contraseña de aplicación de Google]
   MAIL_FROM=Asistencia QR <[tu-correo@gmail.com]>
   ```

   No hace falta definir `PORT`, `DB_PATH` ni `BACKUP_DIR`: Railway pone el puerto y el `Dockerfile` ya guarda todo en `/data`.
6. Espera a que el despliegue quede en verde y abre el dominio. Crea tu cuenta con el mismo correo que pusiste en `ADMIN_EMAILS`.
7. Abre el mismo enlace en tu celular, crea un curso de prueba y escanea un carné.

Cada vez que subas cambios a la rama `main` de GitHub, Railway vuelve a publicar la app sola. La base de datos no se pierde porque está en el volumen.

## Otras opciones

- **Render:** también publica desde GitHub con HTTPS. Para tener disco persistente necesitas una instancia paga (desde unos 7 USD al mes)
  más 0,25 USD por GB de disco. Crea un *Web Service* desde el repositorio (usa el `Dockerfile`), agrega un *Disk* montado en `/data`
  y define las mismas variables. Las instancias gratuitas se apagan cuando no hay uso y no conservan archivos.
- **Un servidor propio (VPS) con Docker:** la opción más económica a largo plazo, pero tú administras el servidor.

  ```bash
  docker build -t asistencia-qr .
  docker run -d --name asistencia-qr --restart unless-stopped \
    -p 3000:3000 -v asistencia-datos:/data --env-file .env asistencia-qr
  ```

  Para el HTTPS pon delante un proxy como Caddy (`asistencia.tudominio.com { reverse_proxy localhost:3000 }`), que obtiene el certificado solo,
  y define `TRUST_PROXY=true` y `COOKIE_SECURE=true`.

## Después de publicar

- **Copias de seguridad:** la app crea una copia diaria en `/data/backups` y conserva las últimas 14. Esas copias están en el mismo disco que la base
  de datos, así que **una vez por semana** entra a *Mi cuenta → Copias de seguridad*, descarga la más reciente y guárdala en otro lugar (Google Drive, por ejemplo).
- **Restaurar una copia:** detén la app y ejecuta `npm run restore -- ruta/de/la/copia.db` (en un VPS) o pide ayuda para hacerlo en el hosting.
  Nunca copies a mano solo el archivo `asistencia.db` con la app encendida: puede quedar incompleto. Usa `npm run backup` o la copia automática.
- **Política de datos:** revisa la página `/privacidad.html` y el formato `/autorizacion-acudientes.html` con un abogado o con el área jurídica del colegio
  antes de registrar estudiantes reales.
- **Salud del servicio:** `GET /api/health` responde `{"ok":true}` cuando la app y la base de datos funcionan; el `Dockerfile` ya lo usa.
