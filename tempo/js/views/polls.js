// Polls — quick votes with live results.
import { h, icon, esc, uid, toast } from '../utils.js';
import { state, subscribe, savePolls, logChange } from '../state.js';

let voteStorage = {};
try { voteStorage = JSON.parse(localStorage.getItem('tempo:votes') || '{}'); } catch {}

export function renderPolls(root) {
  let creatorOpen = false;
  const grid = h('div.polls-grid');
  const creator = h('div.card.poll-creator', { hidden: true });

  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 10 · gather consensus'),
        h('h1', 'Polls'),
      ),
    ),
    h('div.view-header-actions',
      h('button.btn.btn-primary', { onclick: () => { creatorOpen = !creatorOpen; creator.hidden = !creatorOpen; } }, icon('plus'), 'New poll'),
    ),
  );

  // Creator
  const qInput = h('input.input', { placeholder: 'What should we...?' });
  const optsWrap = h('div.opts');
  function newOptRow(i) {
    const row = h('div.opt-row',
      h('input.input.opt', { placeholder: `Option ${i}` }),
      h('button.btn.btn-icon.btn-ghost', { onclick: () => row.remove() }, '−'),
    );
    return row;
  }
  optsWrap.append(newOptRow(1), newOptRow(2));
  creator.append(
    h('div', h('label.field-label', 'question'), qInput),
    h('div',
      h('label.field-label', 'options'),
      optsWrap,
      h('button.btn.btn-ghost', { style: { marginTop: '8px' }, onclick: () => optsWrap.appendChild(newOptRow(optsWrap.children.length + 1)) }, '+ add option'),
    ),
    h('div.modal-actions',
      h('button.btn.btn-ghost', { onclick: () => { creator.hidden = true; creatorOpen = false; } }, 'Cancel'),
      h('button.btn.btn-primary', { onclick: async () => {
        const q = qInput.value.trim();
        const opts = [...optsWrap.querySelectorAll('.opt')].map(i => i.value.trim()).filter(Boolean);
        if (!q || opts.length < 2) { toast('Need question + 2+ options', 'warn'); return; }
        state.polls.unshift({
          id: uid(), question: q,
          options: opts.map(t => ({ id: uid(), text: t, votes: 0 })),
          createdBy: state.user.name, createdAt: Date.now(),
        });
        await savePolls();
        await logChange('created a poll', q);
        qInput.value = '';
        [...optsWrap.querySelectorAll('.opt')].forEach(i => i.value = '');
        creator.hidden = true; creatorOpen = false;
        render();
      } }, 'Create'),
    ),
  );

  function render() {
    grid.innerHTML = '';
    if (!state.polls.length) {
      grid.appendChild(h('div.empty', h('span.hash', '#'), h('br'), 'No polls yet · still water'));
      return;
    }
    state.polls.forEach(p => {
      const total = p.options.reduce((s, o) => s + o.votes, 0);
      const myVote = voteStorage[p.id];
      const card = h('div.card.poll',
        h('div.poll-q', p.question),
        h('div.poll-opts',
          ...p.options.map(o => {
            const pct = total ? Math.round(o.votes / total * 100) : 0;
            return h('button.poll-opt' + (myVote === o.id ? '.voted' : ''),
              { onclick: () => vote(p, o) },
              h('div.bar', { style: { width: pct + '%' } }),
              h('div.opt-content', h('span', o.text), h('span.pct', pct + '%')),
            );
          })
        ),
        h('div.poll-foot',
          h('span', `# ${total} vote${total !== 1 ? 's' : ''}`),
          h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('span', 'by ' + (p.createdBy || '?')),
            h('button', { style: { background: 'none', border: 'none', color: 'var(--dusk)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }, onclick: async () => {
              if (!confirm('Delete poll?')) return;
              state.polls = state.polls.filter(x => x.id !== p.id);
              await savePolls();
            } }, 'delete'),
          ),
        ),
      );
      grid.appendChild(card);
    });
  }

  async function vote(poll, opt) {
    const prev = voteStorage[poll.id];
    if (prev === opt.id) {
      const o = poll.options.find(o => o.id === prev); if (o) o.votes = Math.max(0, o.votes - 1);
      delete voteStorage[poll.id];
    } else {
      if (prev) { const o = poll.options.find(o => o.id === prev); if (o) o.votes = Math.max(0, o.votes - 1); }
      opt.votes++;
      voteStorage[poll.id] = opt.id;
      await logChange('voted on a poll', poll.question);
    }
    localStorage.setItem('tempo:votes', JSON.stringify(voteStorage));
    await savePolls();
  }

  root.append(header, h('div.view-body', creator, grid));
  render();
  const unsub = subscribe('polls', render);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}
