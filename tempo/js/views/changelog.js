// Changelog — audit log.
import { h, icon, esc, timeAgo, USER_COLORS } from '../utils.js';
import { state, subscribe, logChange } from '../state.js';
import { saveKey } from '../api.js';

export function renderChangelog(root) {
  const list = h('div.changelog-list');
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 12 · the full tide log'),
        h('h1', 'Changelog'),
      ),
    ),
    h('div.view-header-actions',
      h('button.btn.btn-ghost', { onclick: async () => {
        if (!confirm('Clear the changelog?')) return;
        state.changelog = [];
        await saveKey('tempo:changelog', []);
      } }, 'Clear'),
    ),
  );
  function render() {
    list.innerHTML = '';
    if (!state.changelog.length) {
      list.appendChild(h('div.empty', h('span.hash', '#'), h('br'), 'Nothing logged yet'));
      return;
    }
    state.changelog.forEach(e => {
      list.appendChild(h('div.cl-entry',
        h('div.cl-dot', { style: { background: e.color || '#22d3ee', boxShadow: `0 0 6px ${e.color || '#22d3ee'}` } }),
        h('div.cl-body',
          h('div.cl-action', h('span.cl-who', { style: { color: e.color || '#22d3ee' } }, e.user), ' ' + e.action),
          e.detail ? h('div.cl-detail', '# ' + e.detail) : null,
        ),
        h('div.cl-time', timeAgo(e.ts)),
      ));
    });
  }
  root.append(header, h('div.view-body', list));
  render();
  const unsub = subscribe('changelog', render);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}
