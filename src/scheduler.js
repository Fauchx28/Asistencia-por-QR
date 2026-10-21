// Envío automático del Excel semanal. Revisa cada minuto si ya es el día y la hora configurados
// (por defecto viernes 16:00, hora del colegio). Si el servidor estuvo apagado a esa hora,
// envía en cuanto vuelva a encender ese mismo día. Nunca envía dos veces la misma semana.
const { localParts } = require('./util');

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function shouldRun(now, day, time) {
  const p = localParts(now);
  return WEEKDAYS[p.weekday.toLowerCase().slice(0, 3)] === day && p.time >= time;
}

function startScheduler(reports) {
  if (process.env.REPORT_AUTO_SEND === 'false') return null;
  const day = Number(process.env.REPORT_DAY ?? 5);
  const time = process.env.REPORT_TIME || '16:00';
  let running = false;

  const tick = async () => {
    if (running || !shouldRun(new Date(), day, time)) return;
    running = true;
    try {
      const results = await reports.runScheduled();
      for (const r of results) {
        console.log(r.sent ? `[reporte] curso ${r.course}: enviado a ${r.recipient}` : `[reporte] curso ${r.course}: ${r.error}`);
      }
    } catch (err) {
      console.error('[reporte] error:', err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 60 * 1000);
  timer.unref();
  tick();
  return timer;
}

module.exports = { startScheduler, shouldRun };
