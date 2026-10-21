/* Asistencia QR — aplicación del navegador (sin frameworks). */
(() => {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#main');

  const store = {
    get(k) { try { return localStorage.getItem('aqr:' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('aqr:' + k, v); } catch { /* sin almacenamiento */ } }
  };

  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    courses: '<path d="M4 6l8-3 8 3-8 3z"/><path d="M4 6v6l8 3 8-3V6"/><path d="M8 18l4 2 4-2"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4"/>'
  };
  const icon = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${ICON[name] || ''}</svg>`;

  const STATUS_LABEL = { presente: 'Presente', tarde: 'Tarde', ausente: 'Ausente' };
  const LETTER = { presente: 'P', tarde: 'T', ausente: 'A' };
  const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const state = { teacher: null, config: { timezone: 'America/Bogota' }, courses: null, draft: null };

  // Fecha de hoy (YYYY-MM-DD) en la zona horaria del colegio.
  function todayStr() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: state.config.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtDate = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
  const mondayOf = (s) => addDays(s, -((parseDate(s).getUTCDay() + 6) % 7));
  const longDate = (s) => { const d = parseDate(s); return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const timeOf = (iso) => (iso && iso.length >= 16 ? fmt12(iso.slice(11, 16)) : '');
  function fmt12(hhmm) {
    if (!hhmm) return '';
    let [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---------------------------------------------------------------- API
  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch {
      throw new Error('No hay conexión con el servidor. Revisa tu internet.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/auth/')) {
      state.teacher = null;
      go('#/login');
      throw new Error(data.error || 'Inicia sesión para continuar.');
    }
    if (!res.ok) throw new Error(data.error || 'Algo salió mal. Inténtalo de nuevo.');
    return data;
  }

  async function loadCourses(force = false) {
    if (!state.courses || force) state.courses = (await api('/courses')).courses;
    return state.courses;
  }

  // ---------------------------------------------------------------- UI comunes
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 5000 : 3000);
  }

  function setPage(html) {
    main.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function loading(text = 'Cargando…') {
    setPage(`<div class="loading"><span class="spinner"></span> ${esc(text)}</div>`);
  }

  function errorPage(err) {
    setPage(`<div class="page narrow"><div class="card empty">${icon('alert')}<h2>No pudimos cargar esta página</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Volver al inicio</a></div></div>`);
  }

  // Diálogo modal reutilizable. `body` es HTML; resuelve con el FormData o null si se cancela.
  function dialog({ title, body = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, onOpen }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'sheet';
      d.innerHTML = `<form method="dialog">
        <h2>${esc(title)}</h2>
        ${body}
        <div class="form-error" hidden></div>
        <div class="row" style="justify-content:flex-end">
          ${cancel ? `<button class="btn" value="cancel" type="submit" formnovalidate>${esc(cancel)}</button>` : ''}
          ${ok ? `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok" type="submit">${esc(ok)}</button>` : ''}
        </div></form>`;
      document.body.appendChild(d);
      const form = $('form', d);
      let result = null;
      form.addEventListener('submit', (e) => {
        if (e.submitter && e.submitter.value === 'ok') result = new FormData(form);
      });
      d.addEventListener('close', () => { d.remove(); resolve(result); });
      d.showModal();
      if (onOpen) onOpen(d);
      const first = $('input, select, textarea', d);
      if (first) first.focus();
    });
  }
  const confirmDialog = (title, message, ok = 'Confirmar', danger = false) =>
    dialog({ title, body: `<p style="margin:0" class="muted">${esc(message)}</p>`, ok, danger }).then(Boolean);

  // ---------------------------------------------------------------- navegación
  const NAV = [
    { key: 'home', href: '#/', label: 'Inicio', side: 'Hoy', icon: 'home' },
    { key: 'scan', href: '#/scan', label: 'Escanear', side: 'Escanear QR', icon: 'scan' },
    { key: 'list', href: '#/list', label: 'Lista', side: 'Lista del día', icon: 'list', sideOnly: true },
    { key: 'week', href: '#/week', label: 'Semana', side: 'Resumen semanal', icon: 'week' },
    { key: 'courses', href: '#/courses', label: 'Cursos', side: 'Cursos y QR', icon: 'courses' }
  ];

  function renderNav(active) {
    const logged = Boolean(state.teacher);
    $('#sidebar').hidden = !logged;
    $('#bottom-nav').hidden = !logged;
    if (!logged) return;
    const link = (n, text) => `<a href="${n.href}" ${n.key === active ? 'aria-current="page"' : ''}>${icon(n.icon)}${esc(text)}</a>`;
    $('#side-nav').innerHTML = NAV.map((n) => link(n, n.side)).join('');
    $('#bottom-nav').innerHTML = NAV.filter((n) => !n.sideOnly).map((n) => link(n, n.label)).join('');
    $('#side-user').textContent = state.teacher.name;
  }

  let cleanup = null; // función para detener la cámara u otros recursos al salir de una vista
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  const routes = [
    [/^#\/login$/, viewLogin, null, true],
    [/^#\/?$/, viewHome, 'home'],
    [/^#\/scan(?:\/(\d+))?$/, viewScan, 'scan'],
    [/^#\/list(?:\/(\d+))?$/, viewList, 'list'],
    [/^#\/week(?:\/(\d+))?$/, viewWeek, 'week'],
    [/^#\/courses$/, viewCourses, 'courses'],
    [/^#\/courses\/new$/, viewNewCourse, 'courses'],
    [/^#\/courses\/(\d+)\/qr$/, viewQr, 'courses'],
    [/^#\/courses\/(\d+)\/settings$/, viewSettings, 'courses']
  ];

  async function route() {
    if (cleanup) { try { await cleanup(); } catch { /* nada */ } cleanup = null; }
    const [path, qs] = (location.hash || '#/').split('?');
    const params = new URLSearchParams(qs || '');
    for (const [re, view, navKey, isPublic] of routes) {
      const m = re.exec(path);
      if (!m) continue;
      if (!isPublic && !state.teacher) return go('#/login');
      if (isPublic && state.teacher) return go('#/');
      renderNav(navKey);
      try {
        await view(m.slice(1), params);
      } catch (err) {
        console.error(err);
        if (state.teacher) errorPage(err);
      }
      main.focus({ preventScroll: true });
      return;
    }
    go('#/');
  }

  // Para vistas que necesitan un curso: usa el de la URL, el último usado o pide escoger.
  async function resolveCourse(idParam, target) {
    const courses = await loadCourses();
    if (!courses.length) { go('#/courses/new'); return null; }
    let id = idParam ? Number(idParam) : Number(store.get('lastCourse'));
    let course = courses.find((c) => c.id === id);
    if (!course && !idParam && courses.length === 1) course = courses[0];
    if (!course && !idParam) { await pickCourse(target, courses); return null; }
    if (!course) throw new Error('No encontramos ese curso.');
    store.set('lastCourse', String(course.id));
    return course;
  }

  function pickCourse(target, courses) {
    const titles = { scan: 'tomar asistencia', list: 'ver la lista', week: 'ver el resumen' };
    setPage(`<div class="page narrow">
      <div class="titles"><h1>Elige un curso</h1><p class="muted" style="margin:4px 0 0">¿En qué curso quieres ${titles[target] || 'continuar'}?</p></div>
      <div class="picker-list">${courses.map((c) => `
        <a class="card spread" style="text-decoration:none;color:inherit" href="#/${target}/${c.id}">
          <span class="stack" style="gap:2px"><strong>${esc(c.name)}${c.subject ? ' · ' + esc(c.subject) : ''}</strong>
          <span class="small muted">${plural(c.student_count, 'estudiante', 'estudiantes')}${c.start_time ? ' · ' + fmt12(c.start_time) : ''}</span></span>
          ${icon('next', 'width="20" height="20" style="fill:none;stroke:currentColor;stroke-width:2"')}
        </a>`).join('')}
      </div></div>`);
  }

  function courseSwitcher(course, target) {
    if (!state.courses || state.courses.length < 2) return '';
    return `<label class="sr-only" for="course-switch">Cambiar de curso</label>
      <select class="select" id="course-switch" style="width:auto;min-width:150px">
        ${state.courses.map((c) => `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>`;
  }
  function bindSwitcher(target, keepQs = '') {
    const sel = $('#course-switch');
    if (sel) sel.addEventListener('change', () => go(`#/${target}/${sel.value}${keepQs}`));
  }

  // ---------------------------------------------------------------- Login / registro
  async function viewLogin() {
    renderNav(null);
    let mode = 'login';
    const draw = () => {
      setPage(`<div class="auth-wrap"><div class="auth-card">
        <span class="brand"><span class="brand-mark">${icon('qr')}</span>Asistencia QR</span>
        <div class="card stack" style="gap:16px;padding:22px">
          <div><h1 style="font-size:24px">${mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}</h1>
          <p class="muted" style="margin:4px 0 0">${mode === 'login' ? 'Toma asistencia escaneando el QR de tus estudiantes.' : 'Solo necesitas tu nombre, correo y una contraseña.'}</p></div>
          <form id="auth-form" class="stack" novalidate>
            ${mode === 'register' ? '<label class="field">Nombre<input class="input" name="name" autocomplete="name" required></label>' : ''}
            <label class="field">Correo<input class="input" type="email" name="email" autocomplete="email" required></label>
            <label class="field"><span>Contraseña${mode === 'register' ? ' <span class="hint">(mínimo 8 caracteres)</span></span>' : ''}
              <input class="input" type="password" name="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></label>
            <div class="form-error" hidden></div>
            <button class="btn btn-primary btn-lg" type="submit">${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
          </form>
          ${state.config.allow_registration !== false ? `<p class="small muted" style="margin:0;text-align:center">${mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
            <button class="link-btn" id="toggle-mode" type="button">${mode === 'login' ? 'Regístrate' : 'Inicia sesión'}</button></p>` : ''}
        </div></div></div>`);
      const t = $('#toggle-mode');
      if (t) t.onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
      $('#auth-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = $('button[type=submit]', f);
        const errBox = $('.form-error', f);
        btn.disabled = true;
        errBox.hidden = true;
        try {
          const data = await api(`/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
          state.teacher = data.teacher;
          state.courses = null;
          go('#/');
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
          btn.disabled = false;
        }
      };
      $('input', main).focus();
    };
    draw();
  }

  // ---------------------------------------------------------------- Inicio
  async function viewHome() {
    loading();
    const courses = await loadCourses(true);
    const first = state.teacher.name.split(' ')[0];
    const dateLabel = cap(longDate(todayStr()));

    const cards = courses.map((c) => {
      const total = c.student_count || 0;
      const pct = total ? Math.round((c.present_today / total) * 100) : 0;
      const status = c.closed_today ? ['Cerrada', 'chip-presente'] : c.recorded_today ? ['En curso', 'chip-tarde'] : ['Pendiente', 'chip-none'];
      return `<article class="card course-card">
        <div class="spread" style="align-items:flex-start">
          <div class="stack" style="gap:2px;min-width:0">
            <h3>${esc(c.name)}${c.subject ? ' · ' + esc(c.subject) : ''}</h3>
            <span class="small muted">${c.schedule ? esc(c.schedule) : c.start_time ? 'Inicia ' + fmt12(c.start_time) : plural(total, 'estudiante', 'estudiantes')}</span>
          </div>
          <span class="chip ${status[1]}">${status[0]}</span>
        </div>
        <div class="row" style="flex-wrap:nowrap">
          <div class="progress" role="progressbar" aria-label="Asistencia de hoy" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <span class="small" style="font-weight:800;color:var(--ink-2)">${c.present_today}/${total}</span>
        </div>
        <div class="actions">
          <a class="btn" href="#/scan/${c.id}">${icon('scan')}Escanear</a>
          <a class="btn" href="#/list/${c.id}">${icon('list')}Lista</a>
          <a class="btn" href="#/week/${c.id}">${icon('week')}Semana</a>
        </div>
      </article>`;
    }).join('');

    setPage(`<div class="page">
      <div class="page-head">
        <div class="titles"><span class="eyebrow">${esc(dateLabel)}</span><h1>Hola, ${esc(first)}</h1></div>
      </div>
      ${courses.length ? `
        <a class="hero-action" href="#/scan">
          <span class="hero-icon">${icon('scan')}</span>
          <span class="hero-text"><strong>Tomar asistencia</strong><span>Escanea el QR de cada estudiante</span></span>
        </a>
        <div class="spread"><h2>Mis cursos</h2><a class="btn" href="#/courses/new">${icon('plus')}Nuevo curso</a></div>
        <div class="course-grid">${cards}</div>` : `
        <div class="card empty">${icon('courses')}
          <h2>Crea tu primer curso</h2>
          <p>Sube la lista de estudiantes en Excel o una foto, y generamos un código QR para cada uno.</p>
          <a class="btn btn-primary btn-lg" href="#/courses/new">${icon('plus')}Crear curso</a>
        </div>`}
    </div>`);
  }

  // ---------------------------------------------------------------- Escáner
  let audioCtx = null;
  function beep(ok = true) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = ok ? 880 : 220;
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (ok ? 0.15 : 0.35));
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.4);
    } catch { /* sin audio */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 80 : [60, 60, 60]);
  }

  async function viewScan([idParam]) {
    loading();
    const course = await resolveCourse(idParam, 'scan');
    if (!course) return;
    const day = await api(`/courses/${course.id}/attendance`);
    let registered = day.counts.presente + day.counts.tarde;
    const total = day.counts.total;

    setPage(`<div class="scan-page">
      <div class="scan-top">
        <a class="btn btn-icon" href="#/" aria-label="Volver al inicio">${icon('back')}</a>
        <div class="titles"><strong>${esc(course.name)}${course.subject ? ' · ' + esc(course.subject) : ''}</strong>
          <span class="small muted">${esc(cap(longDate(day.date)))}${course.start_time ? ' · ' + fmt12(course.start_time) : ''}</span></div>
        ${courseSwitcher(course)}
      </div>
      <div class="camera" id="camera">
        <div id="reader"></div>
        <div class="camera-frame" aria-hidden="true"></div>
        <div class="camera-msg" id="camera-msg"><div class="stack"><span class="spinner"></span><span>Abriendo la cámara…</span></div></div>
      </div>
      <div class="scan-result idle" id="scan-result" aria-live="assertive">
        <span class="icon">${icon('qr')}</span>
        <span class="txt"><strong>Listo para escanear</strong><span>Centra el código QR del carné en el recuadro</span></span>
      </div>
      <div class="card stack" style="gap:10px;padding:14px 16px">
        <div class="counter"><span class="small muted" style="font-weight:700">Registrados</span><strong id="count">${registered} <small>de ${total}</small></strong></div>
        <div class="progress"><span id="count-bar" style="width:${total ? (registered / total) * 100 : 0}%"></span></div>
      </div>
      <div class="two-btns">
        <a class="btn btn-lg" href="#/list/${course.id}">Marcar a mano</a>
        <a class="btn btn-primary btn-lg" href="#/list/${course.id}">Ver lista</a>
      </div>
    </div>`);
    bindSwitcher('scan');

    const updateCount = () => {
      $('#count').innerHTML = `${registered} <small>de ${total}</small>`;
      $('#count-bar').style.width = `${total ? (registered / total) * 100 : 0}%`;
    };

    const showResult = (kind, title, sub, undoFn) => {
      const box = $('#scan-result');
      if (!box) return;
      const ic = kind === 'ok' ? 'check' : kind === 'late' ? 'clock' : kind === 'err' ? 'alert' : 'qr';
      box.className = `scan-result ${kind}`;
      box.innerHTML = `<span class="icon">${icon(ic)}</span>
        <span class="txt"><strong>${esc(title)}</strong><span>${esc(sub)}</span></span>
        ${undoFn ? '<button class="btn" type="button" id="undo-btn">Deshacer</button>' : ''}`;
      if (undoFn) $('#undo-btn').onclick = undoFn;
      const cam = $('#camera');
      cam.classList.add(kind === 'err' ? 'flash-err' : 'flash-ok');
      setTimeout(() => cam && cam.classList.remove('flash-ok', 'flash-err'), 450);
    };

    let busy = false;
    let lastToken = '';
    let lastAt = 0;

    async function onToken(token) {
      const now = Date.now();
      if (busy || (token === lastToken && now - lastAt < 3500)) return;
      busy = true;
      lastToken = token;
      lastAt = now;
      try {
        const r = await api(`/courses/${course.id}/attendance/scan`, { method: 'POST', body: { token } });
        if (r.already) {
          beep(true);
          showResult('idle', r.student.full_name, `Ya estaba registrado como ${STATUS_LABEL[r.status].toLowerCase()} · ${timeOf(r.recorded_at)}`);
        } else {
          beep(true);
          registered++;
          updateCount();
          const undo = async () => {
            try {
              await api(`/courses/${course.id}/attendance/${r.student.id}`, { method: 'PUT', body: { status: null } });
              registered--;
              updateCount();
              lastToken = '';
              showResult('idle', 'Registro deshecho', `${r.student.full_name} quedó sin registrar`);
            } catch (err) { toast(err.message, 'error'); }
          };
          showResult(r.status === 'tarde' ? 'late' : 'ok', r.student.full_name,
            `Registrado como ${STATUS_LABEL[r.status].toLowerCase()} · ${timeOf(r.recorded_at)}`, undo);
        }
      } catch (err) {
        beep(false);
        showResult('err', 'No se pudo registrar', err.message);
      } finally {
        setTimeout(() => { busy = false; }, 900);
      }
    }

    // Cámara con html5-qrcode.
    const msg = $('#camera-msg');
    const cameraError = (text) => {
      if (!document.body.contains(msg)) return; // el usuario ya salió de esta vista
      msg.hidden = false;
      msg.innerHTML = `<div class="stack"><strong>${esc(text)}</strong>
        <button class="btn" type="button" id="retry-cam">Reintentar</button>
        <span class="small" style="color:#C9D6D9">También puedes marcar la asistencia a mano desde la lista.</span></div>`;
      $('#retry-cam', msg).onclick = () => route();
    };

    if (!window.isSecureContext) {
      cameraError('La cámara solo funciona en una dirección segura (https) o en localhost.');
      return;
    }
    if (!window.Html5Qrcode) {
      // La librería carga con "defer"; espera un momento si aún no está.
      await new Promise((r) => setTimeout(r, 800));
      if (!window.Html5Qrcode) { cameraError('No se pudo cargar el lector de QR. Revisa tu conexión a internet.'); return; }
    }

    if (!document.body.contains(msg)) return;
    const scanner = new window.Html5Qrcode('reader', {
      verbose: false,
      formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });
    let started = false;
    cleanup = async () => {
      if (started) { try { await scanner.stop(); } catch { /* ya detenido */ } }
      try { scanner.clear(); } catch { /* nada */ }
    };
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 10, aspectRatio: 1 }, (text) => onToken(text), () => {});
      started = true;
      msg.hidden = true;
    } catch (err) {
      const name = (err && (err.name || String(err))) || '';
      cameraError(/NotAllowed|Permission/i.test(name)
        ? 'Permite el acceso a la cámara en tu navegador para escanear.'
        : /NotFound|Requested device not found/i.test(name)
          ? 'No encontramos una cámara en este dispositivo.'
          : 'No se pudo abrir la cámara.');
    }
  }

  // ---------------------------------------------------------------- Lista del día
  async function viewList([idParam], params) {
    loading();
    const course = await resolveCourse(idParam, 'list');
    if (!course) return;
    const today = todayStr();
    const date = params.get('date') && params.get('date') <= today ? params.get('date') : today;
    let filter = 'all';
    let query = '';
    let day = await api(`/courses/${course.id}/attendance?date=${date}`);

    const draw = () => {
      const c = day.counts;
      const visible = day.students.filter((s) => {
        if (filter === 'present' && !(s.status === 'presente' || s.status === 'tarde')) return false;
        if (filter === 'missing' && (s.status === 'presente' || s.status === 'tarde')) return false;
        return !query || s.full_name.toLowerCase().includes(query);
      });
      setPageKeepScroll(`<div class="page narrow">
        <div class="page-head">
          <div class="titles"><span class="eyebrow">${esc(course.name)}${course.subject ? ' · ' + esc(course.subject) : ''}</span>
            <h1>Asistencia del día</h1></div>
          <div class="row">
            ${courseSwitcher(course)}
            <label class="sr-only" for="date-input">Fecha</label>
            <input class="input" type="date" id="date-input" value="${date}" max="${today}" style="width:auto">
          </div>
        </div>
        <p class="muted" style="margin:-8px 0 0">${esc(cap(longDate(date)))}${date === today ? ' (hoy)' : ''}</p>
        <div class="stats">
          <div class="stat p"><b>${c.presente}</b><span>Presentes</span></div>
          <div class="stat t"><b>${c.tarde}</b><span>Tarde</span></div>
          <div class="stat a"><b>${c.ausente}</b><span>Ausentes</span></div>
          <div class="stat n"><b>${c.sin_registrar}</b><span>Sin registrar</span></div>
        </div>
        ${day.closed ? `<div class="notice notice-info">${icon('check')}<span>Asistencia cerrada. Aún puedes corregir cualquier estado.</span></div>` : ''}
        <div class="row" style="flex-wrap:wrap">
          <div class="segmented" role="group" aria-label="Filtrar estudiantes" style="flex:1 1 260px">
            <button type="button" data-f="all" aria-pressed="${filter === 'all'}">Todos</button>
            <button type="button" data-f="present" aria-pressed="${filter === 'present'}">Presentes</button>
            <button type="button" data-f="missing" aria-pressed="${filter === 'missing'}">Faltan</button>
          </div>
          <label class="sr-only" for="search">Buscar estudiante</label>
          <input class="input" id="search" type="search" placeholder="Buscar estudiante" value="${esc(query)}" style="flex:1 1 200px">
        </div>
        <div class="card card-flush">
          ${visible.length ? `<ul class="student-list">${visible.map((s) => `
            <li class="student-row">
              <span class="avatar" aria-hidden="true">${esc(initials(s.full_name))}</span>
              <span class="info"><strong>${esc(s.full_name)}</strong>
                <span>${s.status ? `${s.method === 'qr' ? 'QR' : s.method === 'cierre' ? 'Al cerrar el día' : 'Manual'} · ${timeOf(s.recorded_at)}` : esc(s.code)}</span></span>
              <label class="sr-only" for="st-${s.id}">Estado de ${esc(s.full_name)}</label>
              <select class="status-select s-${s.status || 'none'}" id="st-${s.id}" data-sid="${s.id}">
                <option value="" ${!s.status ? 'selected' : ''}>Sin registrar</option>
                <option value="presente" ${s.status === 'presente' ? 'selected' : ''}>Presente</option>
                <option value="tarde" ${s.status === 'tarde' ? 'selected' : ''}>Tarde</option>
                <option value="ausente" ${s.status === 'ausente' ? 'selected' : ''}>Ausente</option>
              </select>
            </li>`).join('')}</ul>`
            : `<div class="empty"><p>${day.students.length ? 'Nadie coincide con este filtro.' : 'Este curso aún no tiene estudiantes.'}</p>
               ${day.students.length ? '' : `<a class="btn" href="#/courses/${course.id}/qr">Agregar estudiantes</a>`}</div>`}
        </div>
        <div class="sticky-foot stack" style="gap:6px">
          ${date === today ? `<a class="btn btn-lg btn-block" href="#/scan/${course.id}">${icon('scan')}Seguir escaneando</a>` : ''}
          ${!day.closed && c.total ? `<button class="btn btn-primary btn-lg btn-block" id="close-day" type="button">Cerrar asistencia del día</button>
            <span class="small muted" style="text-align:center">${c.sin_registrar ? `${plural(c.sin_registrar, 'estudiante sin registrar quedará', 'estudiantes sin registrar quedarán')} como ausente${c.sin_registrar === 1 ? '' : 's'}` : 'Todos los estudiantes tienen registro'}</span>` : ''}
        </div>
      </div>`);

      bindSwitcher('list', date !== today ? `?date=${date}` : '');
      $('#date-input').onchange = (e) => { if (e.target.value) go(`#/list/${course.id}?date=${e.target.value}`); };
      $$('.segmented button').forEach((b) => { b.onclick = () => { filter = b.dataset.f; draw(); }; });
      const search = $('#search');
      search.oninput = () => {
        query = search.value.trim().toLowerCase();
        const pos = search.selectionStart;
        draw();
        const s2 = $('#search'); s2.focus(); s2.setSelectionRange(pos, pos);
      };
      $$('.status-select').forEach((sel) => {
        sel.onchange = async () => {
          sel.disabled = true;
          try {
            await api(`/courses/${course.id}/attendance/${sel.dataset.sid}`, { method: 'PUT', body: { date, status: sel.value || null } });
            day = await api(`/courses/${course.id}/attendance?date=${date}`);
            draw();
          } catch (err) {
            toast(err.message, 'error');
            sel.disabled = false;
          }
        };
      });
      const closeBtn = $('#close-day');
      if (closeBtn) closeBtn.onclick = async () => {
        const n = day.counts.sin_registrar;
        const ok = await confirmDialog('¿Cerrar la asistencia?',
          n ? `${plural(n, 'estudiante sin registrar quedará', 'estudiantes sin registrar quedarán')} como ausente${n === 1 ? '' : 's'}. Podrás corregirlo después.` : 'Todos los estudiantes ya tienen registro.',
          'Cerrar asistencia');
        if (!ok) return;
        try {
          day = await api(`/courses/${course.id}/attendance/close`, { method: 'POST', body: { date } });
          toast('Asistencia cerrada');
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
    };
    draw();
  }

  // Redibuja sin saltar al inicio de la página (para filtros y cambios de estado).
  function setPageKeepScroll(html) {
    const y = window.scrollY;
    main.innerHTML = html;
    window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------- Resumen semanal
  async function viewWeek([idParam], params) {
    loading();
    const course = await resolveCourse(idParam, 'week');
    if (!course) return;
    const ref = params.get('date') || todayStr();
    const w = await api(`/courses/${course.id}/week?date=${ref}`);
    const thisMonday = mondayOf(todayStr());
    const fri = parseDate(w.friday);
    const mon = parseDate(w.monday);
    const range = mon.getUTCMonth() === fri.getUTCMonth()
      ? `${mon.getUTCDate()} al ${fri.getUTCDate()} de ${MONTHS[fri.getUTCMonth()]}`
      : `${mon.getUTCDate()} de ${MONTHS[mon.getUTCMonth()]} al ${fri.getUTCDate()} de ${MONTHS[fri.getUTCMonth()]}`;
    const cfg = state.config;
    const reportDay = DAY_NAMES[cfg.report_day ?? 5];
    const c = w.course;

    const rows = w.rows.map((r) => `<tr>
      <th scope="row" class="name" title="${esc(r.student.full_name)}">${esc(r.student.full_name)}</th>
      ${r.cells.map((s, i) => `<td><span class="mark ${s || 'none'}" title="${s ? STATUS_LABEL[s] : 'Sin registro'}">${s ? LETTER[s] : '·'}</span><span class="sr-only">${w.days[i].label}: ${s ? STATUS_LABEL[s] : 'sin registro'}</span></td>`).join('')}
      <td class="total ${r.pct !== null && r.pct < 80 ? 'pct-low' : ''}">${r.recorded ? `${r.attended}/${r.recorded}` : '—'}</td>
    </tr>`).join('');

    setPage(`<div class="page">
      <div class="page-head">
        <div class="titles"><span class="eyebrow">${esc(c.name)}${c.subject ? ' · ' + esc(c.subject) : ''}</span>
          <h1>Semana del ${esc(range)}</h1></div>
        <div class="row">
          ${courseSwitcher(course)}
          <a class="btn btn-icon" href="#/week/${course.id}?date=${addDays(w.monday, -7)}" aria-label="Semana anterior">${icon('back')}</a>
          ${w.monday !== thisMonday ? `<a class="btn" href="#/week/${course.id}">Esta semana</a>` : ''}
          <a class="btn btn-icon" href="#/week/${course.id}?date=${addDays(w.monday, 7)}" aria-label="Semana siguiente" ${w.monday >= thisMonday ? 'hidden' : ''}>${icon('next')}</a>
          <a class="btn btn-primary" href="/api/courses/${course.id}/week.xlsx?date=${w.monday}" download>${icon('download')}Descargar Excel</a>
        </div>
      </div>

      <div class="card row" style="gap:16px">
        <span class="hero-icon" style="width:40px;height:40px;border-radius:12px;background:var(--brand-soft)">${icon('mail', 'style="width:20px;height:20px;stroke:var(--brand)"')}</span>
        <div class="stack" style="gap:2px;flex:1 1 260px">
          ${cfg.report_auto_send && c.report_email
            ? `<strong>Envío automático cada ${reportDay}, ${fmt12(cfg.report_time)}</strong><span class="small muted">El Excel de la semana se enviará a ${esc(c.report_email)}</span>`
            : `<strong>Recibe el Excel cada ${reportDay}</strong><span class="small muted">${cfg.report_auto_send ? 'Configura el correo al que se enviará el reporte semanal.' : 'El envío automático está desactivado en el servidor.'}</span>`}
          ${cfg.mail_configured ? '' : '<span class="small" style="color:var(--late-ink);font-weight:700">El servidor aún no tiene configurado el correo (SMTP).</span>'}
        </div>
        <div class="row">
          ${c.report_email && cfg.mail_configured ? '<button class="btn" type="button" id="send-now">Enviar ahora</button>' : ''}
          <a class="btn" href="#/courses/${course.id}/settings">Configurar</a>
        </div>
      </div>

      <div class="card card-flush">
        <div class="card-head spread"><h2 style="font-size:15px">Asistencia por estudiante</h2>
          <div class="legend">
            <span><span class="mark presente">P</span>Presente</span>
            <span><span class="mark tarde">T</span>Tarde</span>
            <span><span class="mark ausente">A</span>Ausente</span>
            <span><span class="mark none">·</span>Sin registro</span>
          </div></div>
        ${w.rows.length ? `<div class="table-wrap"><table class="week">
          <thead><tr><th scope="col" class="name">Estudiante</th>${w.days.map((d) => `<th scope="col">${esc(d.label)}</th>`).join('')}<th scope="col" class="total">Asistió</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th scope="row" class="name">Presentes</th>${w.days.map((d) => `<td>${d.registrados ? `${d.presentes}/${d.registrados}` : '—'}</td>`).join('')}<td></td></tr></tfoot>
        </table></div>` : '<div class="empty"><p>Este curso aún no tiene estudiantes.</p></div>'}
      </div>
    </div>`);
    bindSwitcher('week', params.get('date') ? `?date=${w.monday}` : '');

    // En pantallas angostas, muestra la columna de hoy sin tener que deslizar.
    const todayIdx = w.days.findIndex((x) => x.date === todayStr());
    const wrap = $('.table-wrap');
    if (wrap && todayIdx > 1 && wrap.scrollWidth > wrap.clientWidth) {
      const ths = $$('table.week thead th');
      // Deja visible el día anterior junto a la columna fija de nombres.
      wrap.scrollLeft = ths[todayIdx].offsetLeft - ths[0].offsetWidth;
    }

    const send = $('#send-now');
    if (send) send.onclick = async () => {
      if (!(await confirmDialog('Enviar reporte', `Se enviará el Excel de esta semana a ${c.report_email}.`, 'Enviar'))) return;
      send.disabled = true;
      try {
        const r = await api(`/courses/${course.id}/week/send`, { method: 'POST', body: { date: w.monday } });
        toast(`Reporte enviado a ${r.recipient}`);
      } catch (err) { toast(err.message, 'error'); }
      send.disabled = false;
    };
  }

  // ---------------------------------------------------------------- Cursos
  async function viewCourses() {
    loading();
    const courses = await loadCourses(true);
    setPage(`<div class="page">
      <div class="page-head"><div class="titles"><h1>Cursos</h1><span class="muted">${plural(courses.length, 'curso', 'cursos')}</span></div>
        <a class="btn btn-primary" href="#/courses/new">${icon('plus')}Nuevo curso</a></div>
      ${courses.length ? `<div class="course-grid">${courses.map((c) => `
        <article class="card course-card">
          <div class="stack" style="gap:2px"><h3>${esc(c.name)}${c.subject ? ' · ' + esc(c.subject) : ''}</h3>
            <span class="small muted">${plural(c.student_count, 'estudiante', 'estudiantes')}${c.start_time ? ' · inicia ' + fmt12(c.start_time) : ''}</span></div>
          <div class="two-btns">
            <a class="btn" href="#/courses/${c.id}/qr">${icon('qr')}Estudiantes y QR</a>
            <a class="btn" href="#/courses/${c.id}/settings">${icon('gear')}Configurar</a>
          </div>
        </article>`).join('')}</div>`
        : `<div class="card empty">${icon('courses')}<h2>Aún no tienes cursos</h2><p>Crea uno subiendo la lista de estudiantes.</p><a class="btn btn-primary" href="#/courses/new">Crear curso</a></div>`}
    </div>`);
  }

  // ---------------------------------------------------------------- Nuevo curso (pasos 1 y 2)
  function stepsBar(current) {
    const names = ['Datos y lista', 'Revisar', 'Códigos QR'];
    return `<ol class="steps" aria-label="Pasos">${names.map((n, i) =>
      `<li class="${i + 1 < current ? 'done' : i + 1 === current ? 'current' : ''}" ${i + 1 === current ? 'aria-current="step"' : ''}>${i + 1} · ${n}</li>`).join('')}</ol>`;
  }

  async function viewNewCourse() {
    if (!state.draft) state.draft = { step: 1, name: '', subject: '', start_time: '', students: [], source: null, fileName: '', preview: null, showPaste: false, text: '' };
    const d = state.draft;
    if (d.step === 2) return drawReview();
    drawStep1();

    function drawStep1() {
      setPage(`<div class="page narrow">
        <div class="stack" style="gap:14px">${stepsBar(1)}
          <h1>Nuevo curso</h1>
          <p class="muted" style="margin:0">Sube la lista de estudiantes como la tengas. Leemos los nombres y creamos un código QR para cada uno.</p></div>
        <form id="course-form" class="card grid-auto" novalidate>
          <label class="field">Nombre del curso<input class="input" name="name" placeholder="Ej: 5° B" value="${esc(d.name)}" maxlength="80" required></label>
          <label class="field"><span>Materia <span class="hint">(opcional)</span></span><input class="input" name="subject" placeholder="Ej: Matemáticas" value="${esc(d.subject)}"></label>
          <label class="field"><span>Hora de inicio <span class="hint">(opcional, para marcar tardanzas)</span></span><input class="input" type="time" name="start_time" value="${esc(d.start_time)}"></label>
        </form>
        <div class="stack">
          <h2>Lista de estudiantes</h2>
          ${d.students.length ? `<div class="notice notice-info">${icon('check')}<span><strong>${plural(d.students.length, 'nombre leído', 'nombres leídos')}</strong>${d.fileName ? ' de ' + esc(d.fileName) : ''}. Puedes continuar o subir otro archivo.</span></div>` : ''}
          <div class="grid-auto">
            <label class="drop" id="drop-file">
              <input type="file" id="file-input" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">
              <span class="ic">${icon('sheet')}</span>
              <strong>Subir Excel o CSV</strong>
              <p>Arrastra el archivo aquí o toca para elegirlo. Basta con una columna de nombres.</p>
              <small>.xlsx · .csv</small>
            </label>
            <label class="drop" id="drop-photo">
              <input type="file" id="photo-input" accept="image/*">
              <span class="ic">${icon('camera')}</span>
              <strong>Foto de la lista</strong>
              <p>Toma o sube una foto de la lista, impresa o a mano. Leemos los nombres automáticamente.</p>
              <small>.jpg · .png</small>
            </label>
          </div>
          <div id="import-status"></div>
          <div class="row small"><a href="/plantilla-estudiantes.csv" download>Descargar plantilla</a>
            <span class="muted" aria-hidden="true">·</span>
            <button class="link-btn" type="button" id="toggle-paste">${d.showPaste ? 'Ocultar' : 'Prefiero escribir o pegar los nombres'}</button></div>
          ${d.showPaste ? `<div class="card stack">
            <label class="field"><span>Un estudiante por línea <span class="hint">(también puedes pegar columnas copiadas de Excel)</span></span>
              <textarea class="textarea" id="paste-text" placeholder="Ana Pérez&#10;Luis Mora&#10;…">${esc(d.text)}</textarea></label>
            <div><button class="btn" type="button" id="use-text">Usar estos nombres</button></div></div>` : ''}
        </div>
        <div class="form-error" id="step1-error" hidden></div>
        <div class="row" style="justify-content:flex-end">
          <a class="btn btn-lg" href="#/courses" id="cancel-new">Cancelar</a>
          <button class="btn btn-primary btn-lg" type="button" id="to-review">Continuar</button>
        </div>
      </div>`);

      const form = $('#course-form');
      form.oninput = () => Object.assign(d, Object.fromEntries(new FormData(form)));
      $('#cancel-new').onclick = () => { state.draft = null; };
      $('#toggle-paste').onclick = () => { d.showPaste = !d.showPaste; drawStep1(); if (d.showPaste) $('#paste-text').focus(); };
      const pasteBox = $('#paste-text');
      if (pasteBox) pasteBox.oninput = () => { d.text = pasteBox.value; };
      const useText = $('#use-text');
      if (useText) useText.onclick = () => doImport({ text: d.text });

      const bindDrop = (labelId, inputId) => {
        const label = $('#' + labelId);
        const input = $('#' + inputId);
        input.onchange = () => input.files[0] && doImport({ file: input.files[0] });
        label.addEventListener('dragover', (e) => { e.preventDefault(); label.classList.add('dragover'); });
        label.addEventListener('dragleave', () => label.classList.remove('dragover'));
        label.addEventListener('drop', (e) => {
          e.preventDefault();
          label.classList.remove('dragover');
          if (e.dataTransfer.files[0]) doImport({ file: e.dataTransfer.files[0] });
        });
      };
      bindDrop('drop-file', 'file-input');
      bindDrop('drop-photo', 'photo-input');

      $('#to-review').onclick = () => {
        Object.assign(d, Object.fromEntries(new FormData(form)));
        const err = $('#step1-error');
        if (!d.name.trim()) {
          err.textContent = 'Escribe el nombre del curso.';
          err.hidden = false;
          $('input[name=name]').focus();
          return;
        }
        d.step = 2;
        drawReview();
      };
    }

    async function doImport({ file, text }) {
      const status = $('#import-status');
      const isPhoto = file && /^image\//.test(file.type);
      status.innerHTML = `<div class="notice notice-info"><span class="spinner"></span><span>${isPhoto ? 'Leyendo los nombres de la foto… puede tardar unos segundos.' : 'Leyendo la lista…'}</span></div>`;
      $$('.drop input, #use-text').forEach((el) => { el.disabled = true; });
      try {
        let res;
        if (file) {
          const fd = new FormData();
          fd.append('file', file);
          res = await api('/import', { method: 'POST', form: fd });
        } else {
          res = await api('/import', { method: 'POST', body: { text } });
        }
        if (d.preview) URL.revokeObjectURL(d.preview);
        d.preview = isPhoto ? URL.createObjectURL(file) : null;
        d.fileName = file ? file.name : '';
        d.source = res.source;
        d.students = res.students.map((s) => ({ full_name: s.full_name, document: s.document || '', flag: Boolean(s.flag) }));
        const nameInput = $('input[name=name]');
        if (nameInput) d.name = nameInput.value;
        if (d.name.trim()) { d.step = 2; drawReview(); } else drawStep1();
      } catch (err) {
        status.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        $$('.drop input, #use-text').forEach((el) => { el.disabled = false; });
      }
    }

    function drawReview() {
      const flagged = d.students.filter((s) => s.flag).length;
      const count = d.students.filter((s) => s.full_name.trim()).length;
      setPage(`<div class="page">
        <div class="stack" style="gap:14px">${stepsBar(2)}
          <h1>${d.students.length ? `Encontramos ${plural(d.students.length, 'estudiante', 'estudiantes')}` : 'Agrega los estudiantes'}</h1>
          <p class="muted" style="margin:0">Revisa que los nombres estén bien escritos antes de crear <strong>${esc(d.name)}</strong>. Puedes corregir, quitar o agregar.</p></div>
        ${flagged ? `<div class="notice notice-warn">${icon('alert')}<span>${plural(flagged, 'nombre no se leyó', 'nombres no se leyeron')} con claridad. ${flagged === 1 ? 'Está marcado' : 'Están marcados'} en amarillo.</span></div>` : ''}
        <div class="review-layout">
          ${d.preview ? `<figure class="card review-preview" style="margin:0"><img src="${d.preview}" alt="Foto de la lista subida"><figcaption class="spread small"><strong>${esc(d.fileName)}</strong><button class="link-btn" type="button" id="change-file">Cambiar archivo</button></figcaption></figure>` : ''}
          <div class="card card-flush review-table">
            <div class="edit-head"><span>#</span><span>Nombre completo</span><span class="doc">Documento (opcional)</span><span></span></div>
            <div id="edit-rows">${d.students.map((s, i) => editRow(s, i)).join('')}</div>
            <div class="card-foot spread small"><span class="muted">${plural(d.students.length, 'estudiante', 'estudiantes')}</span>
              <button class="link-btn" type="button" id="add-row">+ Agregar estudiante</button></div>
          </div>
        </div>
        <div class="form-error" id="review-error" hidden></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn btn-lg" type="button" id="back-step">Atrás</button>
          <button class="btn btn-primary btn-lg" type="button" id="create-course">Crear curso y generar ${count} QR</button>
        </div>
      </div>`);

      const rowsEl = $('#edit-rows');
      rowsEl.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.i);
        if (Number.isNaN(i)) return;
        d.students[i][e.target.dataset.k] = e.target.value;
        if (e.target.dataset.k === 'full_name') {
          d.students[i].flag = false;
          const row = e.target.closest('.edit-row');
          row.classList.remove('flag');
          const note = $('.flag-note', row);
          if (note) note.remove();
          const n = d.students.filter((s) => s.full_name.trim()).length;
          $('#create-course').textContent = `Crear curso y generar ${n} QR`;
        }
      });
      rowsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove]');
        if (!btn) return;
        d.students.splice(Number(btn.dataset.remove), 1);
        drawReview();
      });
      $('#add-row').onclick = () => {
        d.students.push({ full_name: '', document: '', flag: false });
        drawReview();
        const inputs = $$('#edit-rows input[data-k=full_name]');
        inputs[inputs.length - 1].focus();
      };
      $('#back-step').onclick = () => { d.step = 1; drawStep1(); };
      const change = $('#change-file');
      if (change) change.onclick = () => { d.step = 1; drawStep1(); };
      $('#create-course').onclick = async (e) => {
        const btn = e.currentTarget;
        const err = $('#review-error');
        const students = d.students.filter((s) => s.full_name.trim()).map((s) => ({ full_name: s.full_name, document: s.document }));
        btn.disabled = true;
        err.hidden = true;
        try {
          const { course } = await api('/courses', {
            method: 'POST', body: { name: d.name, subject: d.subject, start_time: d.start_time, students }
          });
          if (d.preview) URL.revokeObjectURL(d.preview);
          state.draft = null;
          state.courses = null;
          store.set('lastCourse', String(course.id));
          go(`#/courses/${course.id}/qr?nuevo=1`);
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          btn.disabled = false;
        }
      };
    }

    function editRow(s, i) {
      return `<div class="edit-row ${s.flag ? 'flag' : ''}">
        <span class="num">${i + 1}</span>
        <label class="sr-only" for="n-${i}">Nombre del estudiante ${i + 1}</label>
        <input class="input" id="n-${i}" data-i="${i}" data-k="full_name" value="${esc(s.full_name)}" placeholder="Nombre y apellidos">
        <label class="sr-only" for="d-${i}">Documento del estudiante ${i + 1}</label>
        <input class="input doc" id="d-${i}" data-i="${i}" data-k="document" value="${esc(s.document)}" placeholder="Opcional" inputmode="numeric">
        <button class="icon-btn" type="button" data-remove="${i}" aria-label="Quitar a ${esc(s.full_name || 'este estudiante')}">${icon('trash')}</button>
        ${s.flag ? '<span class="flag-note">Revisar: lectura poco clara</span>' : ''}
      </div>`;
    }
  }

  // ---------------------------------------------------------------- Estudiantes y QR (paso 3)
  async function viewQr([id], params) {
    loading();
    const isNew = params.get('nuevo') === '1';
    const [{ course }, { students }] = await Promise.all([api(`/courses/${id}`), api(`/courses/${id}/students`)]);
    store.set('lastCourse', String(course.id));
    let query = '';

    const draw = () => {
      const list = students.filter((s) => !query || s.full_name.toLowerCase().includes(query));
      setPageKeepScroll(`<div class="page">
        ${isNew ? `<div class="stack" style="gap:14px">${stepsBar(3)}</div>` : ''}
        <div class="page-head">
          <div class="row" style="gap:14px;flex-wrap:nowrap">
            ${isNew ? `<span class="hero-icon" style="background:var(--brand-soft);border-radius:50%;width:48px;height:48px">${icon('check', 'style="stroke:var(--brand);width:26px;height:26px"')}</span>` : ''}
            <div class="titles"><span class="eyebrow">${isNew ? 'Curso creado' : 'Estudiantes y QR'}</span>
              <h1>${isNew ? `${esc(course.name)} está listo` : esc(course.name)}</h1>
              <span class="muted">${plural(students.length, 'estudiante registrado', 'estudiantes registrados')} · ${plural(students.length, 'código QR', 'códigos QR')}</span></div>
          </div>
          <div class="row">
            <a class="btn" href="/api/courses/${course.id}/qr.zip" download>${icon('download')}Imágenes (.zip)</a>
            <a class="btn btn-primary" href="/api/courses/${course.id}/qr.pdf" download>${icon('print')}Imprimir carnés (PDF)</a>
          </div>
        </div>
        <div class="notice notice-info">${icon('info')}<span>Cada QR guarda solo un código único del estudiante, no sus datos personales. Si alguien pierde el carné, genera uno nuevo desde el menú de su tarjeta y el anterior deja de funcionar.</span></div>
        <div class="row">
          <label class="sr-only" for="qr-search">Buscar estudiante</label>
          <input class="input" type="search" id="qr-search" placeholder="Buscar estudiante" value="${esc(query)}" style="flex:1 1 220px">
          <button class="btn" type="button" id="add-student">${icon('plus')}Agregar estudiante</button>
        </div>
        ${list.length ? `<div class="qr-grid">${list.map((s) => `
          <div class="qr-card">
            <img src="/api/students/${s.id}/qr.png?size=300&v=${encodeURIComponent(s.qr_token.slice(-6))}" alt="Código QR de ${esc(s.full_name)}" loading="lazy" width="150" height="150">
            <strong>${esc(s.full_name)}</strong>
            <span>${esc(course.name)} · ${esc(s.code)}</span>
            <button class="icon-btn menu" type="button" data-menu="${s.id}" aria-label="Opciones de ${esc(s.full_name)}">${icon('more')}</button>
          </div>`).join('')}</div>`
          : `<div class="card empty"><p>${students.length ? 'Nadie coincide con la búsqueda.' : 'Este curso aún no tiene estudiantes.'}</p></div>`}
        <div class="spread">
          <a class="btn" href="#/courses/${course.id}/settings">${icon('gear')}Configurar curso</a>
          <a class="btn btn-primary btn-lg" href="#/scan/${course.id}">${icon('scan')}Tomar asistencia</a>
        </div>
      </div>`);

      const search = $('#qr-search');
      search.oninput = () => {
        query = search.value.trim().toLowerCase();
        draw();
        const s2 = $('#qr-search'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length);
      };
      $('#add-student').onclick = async () => {
        const fd = await dialog({
          title: 'Agregar estudiante', ok: 'Agregar',
          body: `<label class="field">Nombre completo<input class="input" name="full_name" required maxlength="120"></label>
                 <label class="field"><span>Documento <span class="hint">(opcional)</span></span><input class="input" name="document" inputmode="numeric"></label>`
        });
        if (!fd || !String(fd.get('full_name')).trim()) return;
        try {
          const { student } = await api(`/courses/${course.id}/students`, { method: 'POST', body: Object.fromEntries(fd) });
          students.push(student);
          students.sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'));
          state.courses = null;
          toast(`${student.full_name} agregado con su QR`);
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
      $$('[data-menu]').forEach((b) => { b.onclick = () => studentMenu(students.find((s) => s.id === Number(b.dataset.menu))); });
    };

    async function studentMenu(s) {
      let action = null;
      await dialog({
        title: s.full_name, ok: null, cancel: 'Cerrar',
        body: `<p class="small muted" style="margin:0">${esc(s.code)}${s.document ? ' · Doc. ' + esc(s.document) : ''}</p>
          <div class="picker-list">
            <a class="btn btn-block" href="/api/students/${s.id}/qr.png?size=800" download="${esc(s.code)}.png">${icon('download')}Descargar QR</a>
            <button class="btn btn-block" type="button" data-act="edit">${icon('edit')}Editar datos</button>
            <button class="btn btn-block" type="button" data-act="regen">${icon('refresh')}Generar nuevo QR (carné perdido)</button>
            <button class="btn btn-block btn-danger" type="button" data-act="remove">${icon('trash')}Quitar del curso</button>
          </div>`,
        onOpen: (dlg) => $$('[data-act]', dlg).forEach((b) => { b.onclick = () => { action = b.dataset.act; dlg.close(); }; })
      });
      try {
        if (action === 'edit') {
          const fd = await dialog({
            title: 'Editar estudiante', ok: 'Guardar',
            body: `<label class="field">Nombre completo<input class="input" name="full_name" value="${esc(s.full_name)}" required maxlength="120"></label>
                   <label class="field"><span>Documento <span class="hint">(opcional)</span></span><input class="input" name="document" value="${esc(s.document || '')}" inputmode="numeric"></label>`
          });
          if (!fd) return;
          const { student } = await api(`/students/${s.id}`, { method: 'PUT', body: Object.fromEntries(fd) });
          Object.assign(s, student);
          toast('Datos actualizados');
        } else if (action === 'regen') {
          if (!(await confirmDialog('¿Generar un nuevo QR?', `El carné actual de ${s.full_name} dejará de funcionar. Tendrás que imprimir el nuevo.`, 'Generar nuevo QR'))) return;
          const { student } = await api(`/students/${s.id}/regenerate-qr`, { method: 'POST' });
          Object.assign(s, student);
          toast('Nuevo QR generado');
        } else if (action === 'remove') {
          if (!(await confirmDialog('¿Quitar del curso?', `${s.full_name} ya no aparecerá en las listas. Su historial de asistencia se conserva.`, 'Quitar', true))) return;
          await api(`/students/${s.id}`, { method: 'DELETE' });
          students.splice(students.indexOf(s), 1);
          state.courses = null;
          toast('Estudiante quitado');
        } else return;
        draw();
      } catch (err) { toast(err.message, 'error'); }
    }

    draw();
  }

  // ---------------------------------------------------------------- Configurar curso
  async function viewSettings([id]) {
    loading();
    const { course: c } = await api(`/courses/${id}`);
    const cfg = state.config;
    setPage(`<div class="page narrow">
      <div class="page-head"><div class="titles"><span class="eyebrow">Configurar curso</span><h1>${esc(c.name)}</h1></div>
        <a class="btn" href="#/courses/${c.id}/qr">${icon('qr')}Estudiantes y QR</a></div>
      <form id="settings-form" class="stack" novalidate>
        <div class="card stack">
          <h2>Datos del curso</h2>
          <div class="grid-auto">
            <label class="field">Nombre del curso<input class="input" name="name" value="${esc(c.name)}" required maxlength="80"></label>
            <label class="field"><span>Materia <span class="hint">(opcional)</span></span><input class="input" name="subject" value="${esc(c.subject || '')}"></label>
            <label class="field"><span>Horario <span class="hint">(opcional)</span></span><input class="input" name="schedule" value="${esc(c.schedule || '')}" placeholder="Ej: Lun a Vie, 9:00 am"></label>
          </div>
        </div>
        <div class="card stack">
          <h2>Tardanzas</h2>
          <p class="small muted" style="margin:0">Si defines la hora de inicio, quien escanee después de la tolerancia queda como "Tarde".</p>
          <div class="grid-auto">
            <label class="field">Hora de inicio<input class="input" type="time" name="start_time" value="${esc(c.start_time || '')}"></label>
            <label class="field">Minutos de tolerancia<input class="input" type="number" name="late_minutes" min="0" max="180" value="${c.late_minutes}"></label>
          </div>
        </div>
        <div class="card stack">
          <h2>Reporte semanal en Excel</h2>
          <p class="small muted" style="margin:0">${cfg.report_auto_send ? `Se envía automáticamente cada ${DAY_NAMES[cfg.report_day ?? 5]} a las ${fmt12(cfg.report_time)}.` : 'El envío automático está desactivado en el servidor; puedes descargarlo desde el resumen semanal.'}</p>
          <label class="field"><span>Correo de destino <span class="hint">(por ejemplo, coordinación)</span></span>
            <input class="input" type="email" name="report_email" value="${esc(c.report_email || '')}" placeholder="coordinacion@colegio.edu.co"></label>
        </div>
        <div class="form-error" hidden></div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" type="submit">Guardar cambios</button></div>
      </form>
      <div class="card stack" style="border-color:#EBCFC2">
        <h2>Eliminar curso</h2>
        <p class="small muted" style="margin:0">Se borran el curso, sus estudiantes y todo su historial de asistencia. No se puede deshacer.</p>
        <div><button class="btn btn-danger" type="button" id="delete-course">${icon('trash')}Eliminar curso</button></div>
      </div>
    </div>`);

    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = $('.form-error', f);
      const btn = $('button[type=submit]', f);
      err.hidden = true;
      btn.disabled = true;
      try {
        await api(`/courses/${c.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(f)) });
        state.courses = null;
        toast('Cambios guardados');
        go(`#/courses`);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    };
    $('#delete-course').onclick = async () => {
      const fd = await dialog({
        title: '¿Eliminar el curso?', ok: 'Eliminar definitivamente', danger: true,
        body: `<p class="muted" style="margin:0">Para confirmar, escribe el nombre del curso: <strong>${esc(c.name)}</strong></p>
               <input class="input" name="confirm" autocomplete="off" aria-label="Nombre del curso">`
      });
      if (!fd) return;
      if (String(fd.get('confirm')).trim() !== c.name) { toast('El nombre no coincide; el curso no se eliminó.', 'error'); return; }
      try {
        await api(`/courses/${c.id}`, { method: 'DELETE' });
        state.courses = null;
        toast('Curso eliminado');
        go('#/courses');
      } catch (ex) { toast(ex.message, 'error'); }
    };
  }

  // ---------------------------------------------------------------- arranque
  $('#logout-btn').onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* nada */ }
    state.teacher = null;
    state.courses = null;
    state.draft = null;
    go('#/login');
  };

  window.addEventListener('hashchange', route);

  (async () => {
    try {
      const me = await api('/auth/me');
      state.teacher = me.teacher;
      state.config = me.config || state.config;
    } catch (err) {
      toast(err.message, 'error');
    }
    route();
  })();
})();
