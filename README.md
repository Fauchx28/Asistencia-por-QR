# Asistencia QR

Aplicación web para tomar asistencia escolar escaneando el código QR del carné de cada estudiante.
Funciona en celulares y computadores.

- **Crear curso fácil:** sube un Excel/CSV, una foto de la lista o pega los nombres. Revisas los nombres detectados y se generan los QR automáticamente.
- **Carnés:** PDF listo para imprimir (12 por hoja carta) o ZIP con un PNG por estudiante.
- **Tomar asistencia:** la cámara del celular lee los QR uno tras otro, con sonido, vibración y opción de deshacer. Marca "Tarde" según la hora de inicio y la tolerancia del curso.
- **Lista del día:** corrige estados a mano y cierra el día (los no registrados quedan ausentes).
- **Resumen semanal:** tabla de lunes a viernes, descarga en Excel y envío automático por correo cada viernes.

## Cuentas y sesiones (v2)

- **Primera vez:** el docente entra a la plataforma y elige **Crear cuenta** (nombre, correo y contraseña). Si defines
  `REGISTRATION_CODE`, también debe escribir el código del colegio, así solo se registran tus docentes.
  Para cerrar el registro por completo usa `ALLOW_REGISTRATION=false`.
- **Ingresar:** con correo y contraseña. Por defecto la sesión dura hasta cerrar el navegador (o 12 h sin uso).
  Con **Recordarme en este dispositivo** dura 30 días desde el último uso; no conviene en computadores compartidos.
- **Volver donde estaba:** si la sesión vence en medio del trabajo, al ingresar de nuevo regresa a la misma página.
- **Mi cuenta** (icono con tus iniciales en el celular, o tu nombre en el menú lateral): cambiar nombre y contraseña,
  ver los dispositivos con sesión abierta y cerrar cualquiera de ellos o todos los demás. Cambiar la contraseña cierra las demás sesiones.
- **Olvidé mi contraseña:** envía un enlace por correo que vence en 1 hora y sirve una sola vez. Requiere SMTP y `APP_URL`.
- **Protección:** tras 5 intentos fallidos con el mismo correo desde la misma red, el ingreso se bloquea 15 minutos.
  La cookie solo guarda un token aleatorio; en la base de datos se guarda su hash. Se rechazan peticiones desde otros sitios (CSRF).

## Requisitos

- **Node.js 22.13 o superior** (usa la base de datos SQLite integrada en Node, no hay que instalar nada más).
- Internet la primera vez que se lea una foto: Tesseract descarga el idioma español (~2 MB) y lo guarda.

## Instalación

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
npm start
```

Abre http://localhost:3000, crea tu cuenta y tu primer curso.

Para desarrollo con recarga automática: `npm run dev`. Pruebas: `npm test`.

## Usar la cámara desde el celular

Los navegadores solo permiten la cámara en **https** o en `localhost`. Para probar desde tu celular en la misma red:

- **Rápido:** usa un túnel con HTTPS, por ejemplo `npx cloudflared tunnel --url http://localhost:3000` o `ngrok http 3000`, y abre en el celular la dirección `https://…` que te da.
- **En producción:** publícalo en un hosting con HTTPS (Render, Railway, un VPS con Nginx + Let's Encrypt…) y pon `TRUST_PROXY=true`, `COOKIE_SECURE=true` y `APP_URL=https://tu-dominio` en el `.env`.

## Correo semanal

Configura `SMTP_*` en el `.env`. Con Gmail necesitas una *contraseña de aplicación*
(Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones).
Luego, en cada curso → **Configurar**, escribe el correo de destino.

El servidor revisa cada minuto; el día y hora configurados (por defecto viernes 4:00 pm, hora de Colombia)
envía el Excel de la semana a cada curso que tenga correo. Si el servidor estaba apagado a esa hora, envía en cuanto
vuelva a encender ese mismo día. Nunca envía dos veces la misma semana. También puedes enviarlo a mano desde **Semana → Enviar ahora**.

## Formato de la lista

- **Excel (.xlsx) o CSV:** basta una columna con los nombres. Reconoce encabezados como *Nombre*, *Nombres* + *Apellidos*,
  *Estudiante*, *Documento*. Si no hay encabezados, usa la columna con más texto. Los `.xls` antiguos deben guardarse como `.xlsx`.
  Hay una plantilla en `public/plantilla-estudiantes.csv` (también se descarga desde la app).
- **Foto:** funciona mejor con lista impresa, buena luz y la hoja derecha. La letra a mano se lee con menos precisión,
  por eso los nombres dudosos se marcan en amarillo para revisarlos antes de crear el curso.

## Seguridad y datos

- El QR contiene solo un token aleatorio, no datos del estudiante. Si un carné se pierde, "Generar nuevo QR" invalida el anterior.
- Cada docente solo ve sus cursos. Contraseñas con `scrypt`; sesión en cookie `HttpOnly` (ver "Cuentas y sesiones").
- Quitar un estudiante lo oculta de las listas pero conserva su historial.
- Toda la información queda en `data/asistencia.db`: haz copia de ese archivo regularmente.

## Estructura

```
server.js                 Arranque del servidor Express
src/db.js                 Esquema SQLite
src/auth.js               Cuentas, sesiones, límite de intentos y recuperación de contraseña
src/mailer.js             Envío de correos (SMTP)
src/api.js                Rutas /api
src/scheduler.js          Envío automático semanal
src/util.js               Fechas, CSV y limpieza de nombres
src/services/
  courses.js              Cursos y estudiantes
  attendance.js           Escaneo, marcado manual y cierre del día
  reports.js              Resumen semanal, Excel y correo
  importer.js             Excel, CSV, texto y foto (Tesseract)
  qr.js                   QR en PNG, PDF de carnés y ZIP
public/                   Interfaz (HTML, CSS y JavaScript sin frameworks)
test/                     Pruebas de la lógica
```

## API principal

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | Registro e ingreso (`remember: true` = recordarme) |
| GET | `/api/auth/me` | Docente de la sesión actual y configuración pública |
| POST | `/api/auth/forgot` · `/api/auth/reset` | Recuperar contraseña |
| GET/PUT | `/api/account` | Mi cuenta (perfil y sesiones abiertas) |
| PUT | `/api/account/password` | Cambiar contraseña |
| DELETE | `/api/account/sessions/:id` | Cerrar una sesión de otro dispositivo |
| POST | `/api/account/sessions/close-others` | Cerrar todas las demás sesiones |
| GET/POST | `/api/courses` | Listar / crear curso (con `students`) |
| GET/PUT/DELETE | `/api/courses/:id` | Ver / editar / eliminar curso |
| POST | `/api/import` | Leer lista (archivo `file` o `{ text }`); no guarda nada |
| GET/POST | `/api/courses/:id/students` | Estudiantes |
| PUT/DELETE | `/api/students/:sid` | Editar / quitar estudiante |
| POST | `/api/students/:sid/regenerate-qr` | Nuevo QR |
| GET | `/api/students/:sid/qr.png` · `/api/courses/:id/qr.pdf` · `/api/courses/:id/qr.zip` | Códigos |
| GET | `/api/courses/:id/attendance?date=` | Lista del día |
| POST | `/api/courses/:id/attendance/scan` | `{ token }` leído del QR |
| PUT | `/api/courses/:id/attendance/:sid` | `{ date, status }` (`null` = deshacer) |
| POST | `/api/courses/:id/attendance/close` | Cerrar día |
| GET | `/api/courses/:id/week?date=` · `/api/courses/:id/week.xlsx?date=` | Resumen semanal |
| POST | `/api/courses/:id/week/send` | Enviar Excel por correo ahora |
