// Dashboard — command center.
import { h, icon, avatar, esc, fmtTime, timeAgo, dateKey, isToday, USER_COLORS, VALID_USERS } from '../utils.js';
import { state, subscribe } from '../state.js';

export function renderDashboard(root) {
  const me = state.user.name;

  // Compute stats
  const myTasks = state.tasks.filter(t => t.assignee === me && t.col !== 'done');
  const myInProgress = myTasks.filter(t => t.col === 'doing');
  const overdueTasks = state.tasks.filter(t => t.col !== 'done' && t.due && new Date(t.due) < new Date());
  const openTasks = state.tasks.filter(t => t.col !== 'done');

  // Today's events
  const todayKey = dateKey(new Date());
  const todaysEvents = state.events
    .filter(e => e.date === todayKey)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // Recent activity (last 8)
  const recentActivity = state.changelog.slice(0, 8);

  // Online presence
  const onlineNow = Array.from(state.presence.values())
    .filter(p => p.status === 'online' || p.status === 'focusing')
    .map(p => p.user);

  // Focus this week (sum durations)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const focusThisWeek = state.focusSessions
    .filter(s => s.startedAt >= weekStart.getTime() && s.completed)
    .reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const focusHrs = Math.floor(focusThisWeek / 3600_000);
  const focusMins = Math.floor((focusThisWeek % 3600_000) / 60_000);

  // Header
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', `${onlineNow.length} of ${VALID_USERS.length} online`),
        h('h1', 'Team Operations'),
      ),
    ),
    h('div.view-header-actions',
      h('button.btn.btn-ghost', { onclick: () => window.tempoNav.go('video') }, icon('video'), 'Start call'),
      h('button.btn.btn-primary', { onclick: () => window.tempoNav.go('focus') }, icon('bolt'), 'Focus'),
    ),
  );

  // Stats row
  const stats = h('div.dash-stats',
    h('div.card.stat-card.tasks',
      icon('check'),
      h('div.label', 'My tasks'),
      h('div.value', String(myTasks.length)),
      h('div.meta', `${myInProgress.length} in progress`),
    ),
    h('div.card.stat-card' + (overdueTasks.length > 0 ? '.urgent' : ''),
      icon('bolt'),
      h('div.label', 'Overdue'),
      h('div.value', String(overdueTasks.length)),
      h('div.meta', overdueTasks.length ? 'need attention' : 'all clear'),
    ),
    h('div.card.stat-card.events',
      icon('cal'),
      h('div.label', 'Today'),
      h('div.value', String(todaysEvents.length)),
      h('div.meta', todaysEvents.length === 1 ? '1 event' : `${todaysEvents.length} events`),
    ),
    h('div.card.stat-card.focus',
      icon('focus'),
      h('div.label', 'Focus hrs'),
      h('div.value', focusHrs > 0 ? `${focusHrs}h ${focusMins}m` : `${focusMins}m`),
      h('div.meta', 'this week'),
    ),
  );

  // Left column panels
  const leftCol = h('div', { style: { display: 'grid', gap: '14px' } },
    panelUrgent(overdueTasks),
    panelToday(todaysEvents),
    panelRecent(recentActivity),
  );

  // Right column - team
  const rightCol = h('div', { style: { display: 'grid', gap: '14px' } },
    panelTeam(),
  );

  const body = h('div.view-body',
    h('div.dash-grid',
      stats,
      leftCol,
      rightCol,
    ),
  );

  root.append(header, body);

  // Re-render on relevant state changes
  const unsub = [
    subscribe('tasks', () => window.tempoNav.go('dashboard')),
    subscribe('calendar', () => window.tempoNav.go('dashboard')),
    subscribe('changelog', () => window.tempoNav.go('dashboard')),
    subscribe('presence', () => window.tempoNav.go('dashboard')),
    subscribe('focus', () => window.tempoNav.go('dashboard')),
  ];
  // Cleanup on navigation
  root.addEventListener('DOMNodeRemoved', () => unsub.forEach(fn => fn()), { once: true });
}

function panelUrgent(tasks) {
  return h('div.card.dash-panel',
    h('div.dash-panel-head',
      h('div.dash-panel-title', 'Urgent tasks'),
      h('a.dash-panel-link', { onclick: () => window.tempoNav.go('tasks') }, 'View all →'),
    ),
    tasks.length === 0
      ? h('div.empty', { style: { padding: '20px' } }, h('span.hash', '✓'), h('br'), 'All clear · no urgent tasks')
      : h('div.urgent-list',
          ...tasks.slice(0, 5).map(t => h('div.urgent-task',
            h('span.pill.pill-bad', t.due ? `due ${new Date(t.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'overdue'),
            h('span.text', t.text),
          ))
        ),
  );
}

function panelToday(events) {
  return h('div.card.dash-panel',
    h('div.dash-panel-head',
      h('div.dash-panel-title', 'Today'),
      h('a.dash-panel-link', { onclick: () => window.tempoNav.go('calendar') }, 'Calendar →'),
    ),
    events.length === 0
      ? h('div.empty', { style: { padding: '20px' } }, h('span.hash', '·'), h('br'), 'No events today')
      : h('div.today-list',
          ...events.map(e => h('div.today-event',
            h('span.time', e.time || 'all day'),
            h('span.title', e.title),
          ))
        ),
  );
}

function panelRecent(entries) {
  return h('div.card.dash-panel',
    h('div.dash-panel-head',
      h('div.dash-panel-title', 'Recent activity'),
      h('a.dash-panel-link', { onclick: () => window.tempoNav.go('changelog') }, 'Changelog →'),
    ),
    entries.length === 0
      ? h('div.empty', { style: { padding: '20px' } }, 'No activity yet')
      : h('div.activity-list',
          ...entries.map(e => h('div.activity-row',
            h('div.icon-wrap', icon('log')),
            h('div.body',
              h('div.who', { style: { color: e.color || '#22d3ee' } }, e.user),
              h('div.what', e.action + (e.detail ? ` — ${e.detail}` : '')),
            ),
            h('div.when', timeAgo(e.ts)),
          ))
        ),
  );
}

function panelTeam() {
  return h('div.card.dash-panel',
    h('div.dash-panel-head',
      h('div.dash-panel-title', 'Team'),
      h('span.pill.pill-ok', `${Array.from(state.presence.values()).filter(p => p.status === 'online' || p.status === 'focusing').length} online`),
    ),
    h('div.team-list',
      ...VALID_USERS.map(u => {
        const presence = state.presence.get(u);
        const isMe = u === state.user.name;
        let status = 'offline', statusClass = 'offline', statusLabel = 'Offline';
        if (presence) {
          if (presence.status === 'focusing') { statusClass = 'focusing'; statusLabel = 'Focusing'; }
          else if (presence.status === 'online') { statusClass = 'online'; statusLabel = 'Online'; }
          else { statusClass = 'away'; statusLabel = 'Away'; }
        }
        return h('div.team-row',
          { onclick: () => {
              if (isMe) return;
              const dmId = 'dm:' + [state.user.name, u].sort().join('_');
              state.activeChannel = dmId;
              window.tempoNav.go('channels');
            }
          },
          h('div.avatar',
            { style: { background: `linear-gradient(135deg, ${USER_COLORS[u]}, ${USER_COLORS[u]}88)` } },
            u.slice(0, 2).toUpperCase(),
            h('span.status-dot.' + statusClass),
          ),
          h('div.info',
            h('div.name', u, isMe ? ' (you)' : ''),
            h('div.status.' + statusClass, statusLabel),
          ),
        );
      })
    ),
    h('button.btn.btn-ghost', { style: { marginTop: '12px', width: '100%', justifyContent: 'center' }, onclick: () => window.tempoNav.go('video') },
      icon('video'), 'Start a call'
    ),
  );
}
