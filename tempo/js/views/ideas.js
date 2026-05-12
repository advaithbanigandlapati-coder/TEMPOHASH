// Ideas — backlog with likes.
import { h, icon, esc, uid, toast } from '../utils.js';
import { state, subscribe, saveIdeas, logChange } from '../state.js';

let likedStorage = {};
try { likedStorage = JSON.parse(localStorage.getItem('tempo:liked') || '{}'); } catch {}

export function renderIdeas(root) {
  const grid = h('div.ideas-grid');
  const titleInput = h('input.input', { placeholder: 'A new idea...' });
  const catSelect = h('select.select');
  ['Product','Team','Design','Strategy','Experiment','Wild'].forEach(c => catSelect.appendChild(h('option', { value: c }, c)));

  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 11 · what hasn\'t surfaced yet'),
        h('h1', 'Ideas'),
      ),
    ),
  );

  const form = h('div.card', { style: { padding: '16px', display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: '10px', alignItems: 'end', marginBottom: '14px' } },
    h('div', h('label.field-label', 'title'), titleInput),
    h('div', h('label.field-label', 'category'), catSelect),
    h('button.btn.btn-primary', { onclick: async () => {
      const t = titleInput.value.trim(); if (!t) return;
      state.ideas.unshift({ id: uid(), title: t, cat: catSelect.value, likes: 0, createdBy: state.user.name, createdAt: Date.now() });
      await saveIdeas(); await logChange('added an idea', t);
      titleInput.value = ''; render();
    } }, icon('plus'), 'Add'),
  );

  function render() {
    grid.innerHTML = '';
    if (!state.ideas.length) { grid.appendChild(h('div.empty', h('span.hash', '#'), h('br'), 'No ideas yet · dive deeper')); return; }
    state.ideas.forEach(i => {
      const liked = likedStorage[i.id];
      grid.appendChild(h('div.card.idea',
        h('div.icat', '# ' + i.cat),
        h('h5', i.title),
        h('div', { style: { fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--dusk)', marginTop: '6px' } }, 'by ' + (i.createdBy || '?')),
        h('div.idea-foot',
          h('button.like' + (liked ? '.liked' : ''), { onclick: async () => {
            if (liked) { i.likes = Math.max(0, i.likes - 1); delete likedStorage[i.id]; }
            else { i.likes++; likedStorage[i.id] = true; await logChange('liked an idea', i.title); }
            localStorage.setItem('tempo:liked', JSON.stringify(likedStorage));
            await saveIdeas();
          } }, '◈ ' + i.likes),
          h('button', { style: { background: 'none', border: 'none', color: 'var(--dusk)', fontFamily: 'var(--mono)', fontSize: '10px', cursor: 'pointer' }, onclick: async () => {
            if (!confirm('Delete idea?')) return;
            state.ideas = state.ideas.filter(x => x.id !== i.id);
            await saveIdeas();
          } }, 'delete'),
        ),
      ));
    });
  }

  root.append(header, h('div.view-body', form, grid));
  render();
  const unsub = subscribe('ideas', render);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}
