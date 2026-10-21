// Pruebas de cuentas y sesiones: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createAuth, describeAgent } = require('../src/auth');

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36';

function setup() {
  let clock = Date.UTC(2026, 9, 21, 15, 0, 0);
  const db = openDatabase(':memory:');
  const auth = createAuth(db, { now: () => clock });
  return { db, auth, advance: (ms) => { clock += ms; } };
}

const fakeReq = (ua = UA_WIN, cookie = '') => ({ headers: { 'user-agent': ua, cookie }, socket: { remoteAddress: '10.0.0.5' } });
function fakeRes() {
  const res = { cookie: null, setHeader(k, v) { if (k === 'Set-Cookie') res.cookie = v; } };
  return res;
}
const tokenOf = (res) => /sid=([^;]*)/.exec(res.cookie)[1];

// Inicia sesión y devuelve { cookie, sessionId } usando el middleware real.
function signIn(auth, teacherId, { ua = UA_WIN, remember = false } = {}) {
  const res = fakeRes();
  const id = auth.startSession(fakeReq(ua), res, teacherId, { remember });
  return { cookie: `sid=${tokenOf(res)}`, sessionId: id, setCookie: res.cookie };
}
function whoIs(auth, cookie) {
  const req = fakeReq(UA_WIN, cookie);
  auth.loadTeacher(req, fakeRes(), () => {});
  return req;
}

const NEW = { name: 'Laura Rendón', email: 'Laura@Colegio.edu', password: 'secreta123', password_confirm: 'secreta123' };

test('registro: valida datos y no permite correos repetidos', () => {
  const { auth } = setup();
  assert.throws(() => auth.register({ ...NEW, password: '123', password_confirm: '123' }), /al menos 8/);
  assert.throws(() => auth.register({ ...NEW, password_confirm: 'otra' }), /no coinciden/);
  assert.throws(() => auth.register({ ...NEW, email: 'mal' }), /correo/);
  const t = auth.register(NEW);
  assert.equal(t.email, 'laura@colegio.edu');
  assert.throws(() => auth.register(NEW), (e) => e.status === 409);
});

test('registro con código del colegio', () => {
  const { auth } = setup();
  process.env.REGISTRATION_CODE = 'Colegio2026';
  try {
    assert.equal(auth.registrationRequiresCode(), true);
    assert.throws(() => auth.register({ ...NEW, code: 'otro' }), (e) => e.status === 403);
    assert.ok(auth.register({ ...NEW, code: ' colegio2026 ' }).id);
  } finally {
    delete process.env.REGISTRATION_CODE;
  }
});

test('ingreso y límite de intentos fallidos', () => {
  const { auth, advance } = setup();
  auth.register(NEW);
  assert.throws(() => auth.login({ email: 'nadie@x.co', password: 'secreta123' }, '1.1.1.1'), (e) => e.status === 401);
  for (let i = 0; i < 5; i++) {
    assert.throws(() => auth.login({ email: NEW.email, password: 'mala' }, '1.1.1.1'), (e) => e.status === 401);
  }
  // Bloqueado incluso con la contraseña correcta
  assert.throws(() => auth.login({ email: NEW.email, password: 'secreta123' }, '1.1.1.1'), (e) => e.status === 429);
  // Desde otra IP sí puede
  assert.equal(auth.login({ email: NEW.email, password: 'secreta123' }, '2.2.2.2').name, 'Laura Rendón');
  advance(16 * 60 * 1000);
  assert.ok(auth.login({ email: NEW.email, password: 'secreta123' }, '1.1.1.1'));
});

test('sesión normal vs. "recordarme" y expiración por inactividad', () => {
  const { auth, advance } = setup();
  const t = auth.register(NEW);
  const short = signIn(auth, t.id);
  const long = signIn(auth, t.id, { remember: true });
  assert.ok(!/Max-Age/.test(short.setCookie), 'la sesión normal usa cookie de navegador');
  assert.match(long.setCookie, /Max-Age=2592000/);
  assert.equal(whoIs(auth, short.cookie).teacher.id, t.id);

  advance(11 * 3600 * 1000);
  assert.ok(whoIs(auth, short.cookie).teacher, 'actividad dentro de las 12 h renueva la sesión');
  advance(11 * 3600 * 1000);
  assert.ok(whoIs(auth, short.cookie).teacher, 'sigue viva porque hubo actividad');
  advance(13 * 3600 * 1000);
  assert.equal(whoIs(auth, short.cookie).teacher, null, '13 h sin actividad la cierran');
  assert.ok(whoIs(auth, long.cookie).teacher, 'la sesión recordada sigue');
  assert.equal(whoIs(auth, 'sid=inventado').teacher, null);
});

test('Mi cuenta: lista sesiones, cierra una o todas las demás', () => {
  const { auth } = setup();
  const t = auth.register(NEW);
  const phone = signIn(auth, t.id, { ua: UA_ANDROID, remember: true });
  const pc = signIn(auth, t.id, { ua: UA_WIN });
  const other = signIn(auth, t.id, { ua: UA_WIN });

  const acc = auth.getAccount(t.id, pc.sessionId);
  assert.equal(acc.sessions.length, 3);
  assert.deepEqual(acc.sessions.find((s) => s.id === phone.sessionId).device, 'Chrome en Android');
  assert.equal(acc.sessions.find((s) => s.current).id, pc.sessionId);

  auth.revokeSession(t.id, phone.sessionId);
  assert.equal(whoIs(auth, phone.cookie).teacher, null);
  assert.equal(auth.revokeOtherSessions(t.id, pc.sessionId), 1);
  assert.equal(whoIs(auth, other.cookie).teacher, null);
  assert.ok(whoIs(auth, pc.cookie).teacher);
});

test('otro docente no puede cerrar mis sesiones', () => {
  const { auth } = setup();
  const a = auth.register(NEW);
  const b = auth.register({ ...NEW, email: 'pedro@colegio.edu' });
  const sa = signIn(auth, a.id);
  assert.throws(() => auth.revokeSession(b.id, sa.sessionId), (e) => e.status === 404);
  assert.ok(whoIs(auth, sa.cookie).teacher);
});

test('cambiar contraseña cierra las demás sesiones', () => {
  const { auth } = setup();
  const t = auth.register(NEW);
  const here = signIn(auth, t.id);
  const there = signIn(auth, t.id);
  assert.throws(() => auth.changePassword(t.id, here.sessionId, { current_password: 'mala', new_password: 'nueva1234' }), /actual/);
  const r = auth.changePassword(t.id, here.sessionId, { current_password: 'secreta123', new_password: 'nueva1234', password_confirm: 'nueva1234' });
  assert.equal(r.closed_sessions, 1);
  assert.ok(whoIs(auth, here.cookie).teacher);
  assert.equal(whoIs(auth, there.cookie).teacher, null);
  assert.ok(auth.login({ email: NEW.email, password: 'nueva1234' }, '3.3.3.3'));
});

test('recuperar contraseña: enlace de un solo uso que vence en 1 hora', () => {
  const { auth, advance } = setup();
  const t = auth.register(NEW);
  const old = signIn(auth, t.id);
  assert.equal(auth.createResetToken('noexiste@x.co'), null);

  const { token } = auth.createResetToken('laura@colegio.edu');
  auth.checkResetToken(token);
  const teacher = auth.resetPassword({ token, new_password: 'otra12345', password_confirm: 'otra12345' });
  assert.equal(teacher.id, t.id);
  assert.equal(whoIs(auth, old.cookie).teacher, null, 'cierra las sesiones anteriores');
  assert.throws(() => auth.resetPassword({ token, new_password: 'otra99999' }), /no es válido/);

  const second = auth.createResetToken('laura@colegio.edu');
  advance(61 * 60 * 1000);
  assert.throws(() => auth.checkResetToken(second.token), /venció/);
});

test('descripción del dispositivo', () => {
  assert.equal(describeAgent(UA_ANDROID), 'Chrome en Android');
  assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari en iPhone');
  assert.equal(describeAgent(''), 'Navegador');
});
