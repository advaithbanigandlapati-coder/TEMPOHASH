// Focus — pomodoro timer that broadcasts your status to teammates.
import { h, icon, uid, USER_COLORS, toast } from '../utils.js';
import { state, subscribe, saveFocusSessions, logChange, setFocusMode, clearFocusMode } from '../state.js';

let timerState = {
  running: false,
  startedAt: null,
  durationMs: 25 * 60 * 1000,
  remainingMs: 25 * 60 * 1000,
  sessionId: null,
};
let tickHandle = null;

const PRESETS = [
  { label: '25 min', ms: 25 * 60 * 1000 },
  { label: '50 min', ms: 50 * 60 * 1000 },
  { label: '90 min', ms: 90 * 60 * 1000 },
];

export function renderFocus(root) {
  const ring = h('div.focus-ring', { id: 'focusRing' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.innerHTML = `
    <circle class="bg" cx="50" cy="50" r="45"/>
    <circle class="fg" cx="50" cy="50" r="45" stroke-dasharray="${2 * Math.PI * 45}" stroke-dashoffset="0"/>
  `;
  ring.appendChild(svg);
  const timeEl = h('div.focus-time', '25:00');
  ring.appendChild(timeEl);

  const stateEl = h('div.focus-state', 'ready');
  const startBtn = h('button.btn.btn-primary.btn-lg', icon('bolt'), 'Start focus');
  const stopBtn = h('button.btn.btn-ghost.btn-lg', { hidden: true }, 'Stop');

  const presetEls = PRESETS.map(p =>
    h('button.focus-preset' + (p.ms === timerState.durationMs ? '.active' : ''),
      { onclick: () => {
        if (timerState.running) return;
        timerState.durationMs = p.ms;
        timerState.remainingMs = p.ms;
        renderTime();
        presetEls.forEach(el => el.classList.remove('active'));
        // can't reference 'this' cleanly; brute-force re-render
        renderPresets();
      } },
      p.label
    )
  );
  function renderPresets() {
    presetEls.forEach((el, i) => el.classList.toggle('active', PRESETS[i].ms === timerState.durationMs));
  }

  // Stats this week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const mySessionsWeek = state.focusSessions.filter(s => s.user === state.user.name && s.startedAt >= weekStart.getTime() && s.completed);
  const totalMs = mySessionsWeek.reduce((a, s) => a + (s.durationMs || 0), 0);

  const statsEl = h('div.focus-stats',
    h('div.focus-stat', h('div.val', String(mySessionsWeek.length)), h('div.lbl', 'this week')),
    h('div.focus-stat', h('div.val', `${Math.floor(totalMs / 3600_000)}h ${Math.floor((totalMs % 3600_000) / 60_000)}m`), h('div.lbl', 'focus time')),
    h('div.focus-stat', h('div.val', String(state.focusSessions.filter(s => s.user === state.user.name && s.completed).length)), h('div.lbl', 'all-time')),
  );

  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 07 · cut the noise'),
        h('h1', 'Focus'),
      ),
    ),
  );

  const shell = h('div.focus-shell.view-body.no-pad',
    ring,
    stateEl,
    h('div.focus-controls', startBtn, stopBtn),
    h('div.focus-presets', ...presetEls),
    statsEl,
  );

  root.append(header, shell);

  function renderTime() {
    const totalSecs = Math.ceil(timerState.remainingMs / 1000);
    const mm = Math.floor(totalSecs / 60);
    const ss = totalSecs % 60;
    timeEl.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    // Ring progress
    const pct = timerState.durationMs > 0 ? (timerState.durationMs - timerState.remainingMs) / timerState.durationMs : 0;
    const circumference = 2 * Math.PI * 45;
    const fg = svg.querySelector('.fg');
    fg.setAttribute('stroke-dashoffset', String(circumference * (1 - pct)));
  }
  renderTime();

  startBtn.addEventListener('click', () => start());
  stopBtn.addEventListener('click', () => stop(false));

  async function start() {
    timerState.running = true;
    timerState.startedAt = Date.now();
    timerState.sessionId = uid();
    ring.classList.add('running');
    stateEl.textContent = 'focusing'; stateEl.classList.add('running');
    startBtn.hidden = true; stopBtn.hidden = false;
    setFocusMode(timerState.durationMs);
    await logChange('started a focus session', `${Math.round(timerState.durationMs / 60000)}m`);
    tickHandle = setInterval(() => {
      const elapsed = Date.now() - timerState.startedAt;
      timerState.remainingMs = Math.max(0, timerState.durationMs - elapsed);
      renderTime();
      if (timerState.remainingMs === 0) stop(true);
    }, 250);
  }

  async function stop(completed) {
    if (!timerState.running) return;
    clearInterval(tickHandle); tickHandle = null;
    const ran = Date.now() - timerState.startedAt;
    state.focusSessions.unshift({
      id: timerState.sessionId,
      user: state.user.name,
      startedAt: timerState.startedAt,
      endedAt: Date.now(),
      durationMs: completed ? timerState.durationMs : ran,
      plannedMs: timerState.durationMs,
      completed,
    });
    if (state.focusSessions.length > 500) state.focusSessions = state.focusSessions.slice(0, 500);
    await saveFocusSessions();
    timerState.running = false;
    timerState.remainingMs = timerState.durationMs;
    ring.classList.remove('running');
    stateEl.textContent = completed ? 'done · nice' : 'stopped'; stateEl.classList.remove('running');
    startBtn.hidden = false; stopBtn.hidden = true;
    clearFocusMode();
    renderTime();
    if (completed) {
      toast('Focus complete · ' + Math.round(timerState.durationMs / 60000) + ' min', 'ok');
      await logChange('completed a focus session', `${Math.round(timerState.durationMs / 60000)}m`);
    } else {
      await logChange('stopped a focus session', '');
    }
  }

  // Cleanup
  root.addEventListener('DOMNodeRemoved', () => { if (tickHandle) clearInterval(tickHandle); }, { once: true });
}
