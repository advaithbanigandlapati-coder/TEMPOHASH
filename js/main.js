// Entry. Boot sequence:
// 1. Check session via /api/session
// 2. If unauthed → show auth screen
// 3. After auth → init Supabase, load state, render shell, route to view
import { VALID_USERS, USER_COLORS, h, esc, icon, avatar, toast, debounce } from './utils.js';
import { getSession, login, logout, initSupa, getConfig } from './api.js';
import { state, initState, subscribe, markRead, logChange } from './state.js';
import { startAmbient } from './ambient.js';

import { renderDashboard } from './views/dashboard.js';
import { renderChannels } from './views/channels.js';
import { renderCalendar } from './views/calendar.js';
import { renderNotes } from './views/notes.js';
import { renderTasks } from './views/tasks.js';
import { renderFocus } from './views/focus.js';
import { renderVideo } from './views/video.js';
import { renderCanvas } from './views/canvas.js';
import { renderPolls } from './views/polls.js';
import { renderIdeas } from './views/ideas.js';
import { renderPlans } from './views/plans.js';
import { renderChangelog } from './views/changelog.js';

const VIEWS = {
  dashboard: { label: 'Dashboard', icon: 'home',  hash: '01', render: renderDashboard },
  channels:  { label: 'Channels',  icon: 'hash',  hash: '02', render: renderChannels },
  calendar:  { label: 'Calendar',  icon: 'cal',   hash: '03', render: renderCalendar },
  notes:     { label: 'Notes',     icon: 'note',  hash: '04', render: renderNotes },
  tasks:     { label: 'Tasks',     icon: 'check', hash: '05', render: renderTasks },
  plans:     { label: 'Plans',     icon: 'list',  hash: '06', render: renderPlans },
  focus:     { label: 'Focus',     icon: 'focus', hash: '07', render: renderFocus },
  video:     { label: 'Video Call',icon: 'video', hash: '08', render: renderVideo },
  canvas:    { label: 'Canvas',    icon: 'brush', hash: '09', render: renderCanvas },
  polls:     { label: 'Polls',     icon: 'poll',  hash: '10', render: renderPolls },
  ideas:     { label: 'Ideas',     icon: 'bulb',  hash: '11', render: renderIdeas },
  changelog: { label: 'Changelog', icon: 'log',   hash: '12', render: renderChangelog },
};

let currentView = null;

startAmbient();

// ===== Boot =====
(async function boot() {
  const session = await getSession();
  if (!session) { showAuth(); hideSplash(); return; }
  await proceedToApp(session.user);
})();

function hideSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return;
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 400);
}

// ===== Auth =====
function showAuth() {
  const screen = document.getElementById('authScreen');
  screen.hidden = false;
  screen.innerHTML = '';
  let selected = null;
  let isLoading = false;

  const passInput = h('input.input', { type: 'password', placeholder: 'enter password...', autocomplete: 'current-password' });
  const errEl = h('div.auth-error');
  const submit = h('button.btn.btn-primary.auth-submit', 'dive in →');

  const userBtns = VALID_USERS.map(u =>
    h('button.auth-user-btn', { 'data-user': u, onclick: () => { selected = u; updateSelection(); passInput.focus(); } },
      h('span.user-dot', { style: { background: USER_COLORS[u], boxShadow: `0 0 6px ${USER_COLORS[u]}` } }),
      u
    )
  );
  function updateSelection() {
    userBtns.forEach(b => b.classList.toggle('selected', b.getAttribute('data-user') === selected));
  }

  async function attempt() {
    if (isLoading) return;
    const pw = passInput.value;
    if (!selected) { errEl.textContent = '# pick a name first'; return; }
    if (!pw) { errEl.textContent = '# password required'; return; }
    errEl.textContent = '';
    isLoading = true;
    submit.classList.add('loading');
    submit.innerHTML = '<span class="spinner"></span> &nbsp; checking...';
    const result = await login(selected, pw);
    isLoading = false;
    submit.classList.remove('loading');
    submit.textContent = 'dive in →';
    if (!result.ok) { errEl.textContent = '# ' + result.error; return; }
    screen.hidden = true;
    await proceedToApp(selected);
  }

  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  submit.addEventListener('click', attempt);

  const box = h('div.auth-box',
    h('div.auth-brand',
      h('span.mark', '#'),
      h('h1', 'Tempo'),
      h('div.sub', 'a quiet ocean for plans'),
    ),
    h('div.auth-field',
      h('label', 'who are you?'),
      h('div.auth-users', ...userBtns),
    ),
    h('div.auth-field',
      h('label', 'password'),
      passInput,
    ),
    errEl,
    submit,
  );
  screen.appendChild(box);
}

// ===== Proceed to app after auth =====
async function proceedToApp(user) {
  try {
    await initSupa();
  } catch (e) {
    toast('Config error: ' + e.message, 'bad', 6000);
    showAuth();
    hideSplash();
    return;
  }
  const cfg = await getConfig();
  const userObj = { name: cfg.user, color: USER_COLORS[cfg.user] || '#22d3ee' };
  await initState(userObj);

  document.getElementById('authScreen').hidden = true;
  document.getElementById('appRoot').hidden = false;

  renderShell();
  // Subscribe to channel/unread updates to refresh sidebar
  subscribe('channels', renderSidebar);
  subscribe('presence', renderSidebar);
  subscribe('presence', renderTopbar);

  // Route from hash
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);

  // Cmd+K palette
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openPalette();
    }
  });

  // Audit start
  await logChange('opened Tempo');
  hideSplash();
}

// ===== Shell =====
function renderShell() {
  renderSidebar();
  renderTopbar();
}

function renderSidebar() {
  const el = document.getElementById('sidebar');
  el.innerHTML = '';
  el.append(
    h('div.sidebar-brand',
      h('div.mark', '#'),
      h('div.info',
        h('div.name', 'Tempo'),
        h('div.sub', 'command center'),
      ),
    ),
    h('div.sidebar-search', { onclick: openPalette },
      icon('search'),
      h('span', 'Search everything...'),
      h('span.kbd', '⌘K'),
    ),
    h('div.sidebar-scroll',
      // Main sections
      h('div.sidebar-section',
        navItem('dashboard'),
        navItem('calendar'),
        navItem('notes'),
        navItem('tasks'),
        navItem('plans'),
        navItem('focus'),
      ),
      // Channels
      h('div.sidebar-section',
        h('div.sidebar-section-label',
          h('span', '# channels'),
          h('button.add', { title: 'Add channel', onclick: createChannelPrompt }, '+'),
        ),
        ...state.channels.map(ch => channelRail(ch)),
      ),
      // Direct messages
      h('div.sidebar-section',
        h('div.sidebar-section-label',
          h('span', '# direct'),
        ),
        ...VALID_USERS.filter(u => u !== state.user.name).map(u => dmRail(u)),
      ),
      // Collaboration tools
      h('div.sidebar-section',
        h('div.sidebar-section-label', h('span', '# spaces')),
        navItem('video'),
        navItem('canvas'),
        navItem('polls'),
        navItem('ideas'),
        navItem('changelog'),
      ),
    ),
    h('div.sidebar-foot',
      h('div.avatar', { style: { background: `linear-gradient(135deg, ${state.user.color}, ${state.user.color}88)` } },
        state.user.name.slice(0, 2).toUpperCase()
      ),
      h('div.user-info',
        h('div.user-name', state.user.name),
        h('div.user-status', 'Online'),
      ),
      h('button.signout', { title: 'Sign out', onclick: doLogout }, icon('logout')),
    ),
  );
}

function navItem(key) {
  const v = VIEWS[key];
  const isActive = currentView === key;
  return h('button.nav-item' + (isActive ? '.active' : ''),
    { onclick: () => navigate(key) },
    h('span.hash', '#' + v.hash),
    icon(v.icon),
    h('span.label', v.label),
  );
}

function channelRail(ch) {
  const isActive = currentView === 'channels' && state.activeChannel === ch.id;
  const unread = state.unread.get(ch.id) || 0;
  return h('button.channel-item' + (isActive ? '.active' : '') + (unread ? '.unread' : ''),
    { onclick: () => { state.activeChannel = ch.id; navigate('channels'); } },
    h('span.ci-hash', '#'),
    h('span.ci-name', ch.name),
    unread > 0 ? h('span.ci-badge', String(unread)) : null,
  );
}

function dmRail(otherUser) {
  const dmId = [state.user.name, otherUser].sort().join('_');
  const fullId = 'dm:' + dmId;
  const isActive = currentView === 'channels' && state.activeChannel === fullId;
  const presence = state.presence.get(otherUser);
  const isOnline = presence && presence.status === 'online';
  const isFocus = presence && presence.status === 'focusing';
  const unread = state.unread.get(fullId) || 0;
  return h('button.channel-item' + (isActive ? '.active' : '') + (unread ? '.unread' : ''),
    { onclick: () => { state.activeChannel = fullId; navigate('channels'); } },
    h('span.ci-presence' + (isOnline ? '.online' : isFocus ? '.focusing' : ''),
      { style: isFocus ? { background: '#a78bfa', boxShadow: '0 0 4px #a78bfa' } : null }
    ),
    h('span.ci-name', otherUser),
    unread > 0 ? h('span.ci-badge', String(unread)) : null,
  );
}

function renderTopbar() {
  const el = document.getElementById('topbar');
  el.innerHTML = '';
  const v = VIEWS[currentView] || VIEWS.dashboard;
  const onlineCount = Array.from(state.presence.values()).filter(p => p.status === 'online' || p.status === 'focusing').length;
  el.append(
    h('div.topbar-left',
      h('div.topbar-title',
        h('div.crumb', '# ' + v.hash),
        h('div.name', v.label),
      ),
    ),
    h('div.topbar-right',
      h('div.online-count', `${onlineCount} of ${VALID_USERS.length} online`),
      h('div.clock',
        h('div.dot'),
        h('span.time#clockTime', new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })),
      ),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => navigate('video') }, icon('video'), 'Start call'),
      h('button.btn.btn-primary.btn-sm', { onclick: () => navigate('focus') }, icon('bolt'), 'Focus'),
    ),
  );
}

// ===== Router =====
function routeFromHash() {
  const hash = location.hash.replace('#', '');
  const view = VIEWS[hash] ? hash : 'dashboard';
  navigate(view, false);
}

function navigate(view, pushHash = true) {
  if (!VIEWS[view]) view = 'dashboard';
  if (pushHash) history.replaceState({}, '', '#' + view);
  currentView = view;
  const main = document.getElementById('main');
  main.innerHTML = '';
  const node = h('div.view.active');
  main.appendChild(node);
  try {
    VIEWS[view].render(node);
  } catch (e) {
    console.error('View render failed:', e);
    node.appendChild(h('div.empty', h('span.hash', '#'), h('br'), 'View failed to render: ' + e.message));
  }
  renderSidebar();
  renderTopbar();
}

export function go(view) { navigate(view); }
export function goChannel(chId) { state.activeChannel = chId; navigate('channels'); }

// Re-export so views can request these without imports
window.tempoNav = { go, goChannel };

// ===== Command Palette =====
function openPalette() {
  const backdrop = document.getElementById('paletteBackdrop');
  backdrop.hidden = false;
  backdrop.innerHTML = '';

  const input = h('input.palette-input', { placeholder: 'Search views, channels, commands...', autofocus: true });
  const results = h('div.palette-results');
  const palette = h('div.palette', input, results);
  backdrop.appendChild(palette);

  let focusedIdx = 0;
  let items = [];

  function buildItems(query = '') {
    const q = query.toLowerCase().trim();
    const out = [];
    // Views
    for (const [k, v] of Object.entries(VIEWS)) {
      if (!q || v.label.toLowerCase().includes(q)) {
        out.push({ label: v.label, meta: 'View', icon: v.icon, action: () => navigate(k) });
      }
    }
    // Channels
    for (const ch of state.channels) {
      if (!q || ch.name.toLowerCase().includes(q)) {
        out.push({ label: '#' + ch.name, meta: 'Channel', icon: 'hash', action: () => { state.activeChannel = ch.id; navigate('channels'); } });
      }
    }
    // Users (DM)
    for (const u of VALID_USERS) {
      if (u === state.user.name) continue;
      if (!q || u.toLowerCase().includes(q)) {
        const dmId = 'dm:' + [state.user.name, u].sort().join('_');
        out.push({ label: u, meta: 'Direct message', icon: 'msg', action: () => { state.activeChannel = dmId; navigate('channels'); } });
      }
    }
    return out;
  }

  function renderResults(query = '') {
    items = buildItems(query);
    results.innerHTML = '';
    if (!items.length) {
      results.appendChild(h('div.palette-empty', 'No matches.'));
      return;
    }
    items.forEach((it, i) => {
      const row = h('div.palette-item' + (i === focusedIdx ? '.focused' : ''),
        { onclick: () => { it.action(); close(); } },
        icon(it.icon || 'hash'),
        h('span.label', it.label),
        h('span.meta', it.meta),
      );
      results.appendChild(row);
    });
  }

  function close() { backdrop.hidden = true; document.removeEventListener('keydown', onKey); }
  function onKey(e) {
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowDown') { focusedIdx = Math.min(items.length - 1, focusedIdx + 1); renderResults(input.value); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { focusedIdx = Math.max(0, focusedIdx - 1); renderResults(input.value); e.preventDefault(); }
    else if (e.key === 'Enter') { items[focusedIdx]?.action(); close(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);
  input.addEventListener('input', () => { focusedIdx = 0; renderResults(input.value); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  renderResults();
  setTimeout(() => input.focus(), 30);
}

async function createChannelPrompt() {
  const name = prompt('Channel name (no spaces, lowercase):');
  if (!name) return;
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  if (!cleaned) return;
  if (state.channels.find(c => c.id === cleaned)) {
    toast('Channel already exists', 'warn');
    return;
  }
  state.channels.push({ id: cleaned, name: cleaned, topic: '', type: 'channel', createdAt: Date.now(), createdBy: state.user.name });
  state.channelMessages.set(cleaned, []);
  const { saveChannels } = await import('./state.js');
  await saveChannels();
  await logChange('created a channel', '#' + cleaned);
  renderSidebar();
}

async function doLogout() {
  await logChange('signed out');
  await logout();
  location.reload();
}

// Tick clock
setInterval(() => {
  const t = document.getElementById('clockTime');
  if (t) t.textContent = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}, 30000);
