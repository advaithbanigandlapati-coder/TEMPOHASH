// Tasks — kanban with priority, due dates, assignees, filters.
import { h, icon, esc, uid, USER_COLORS, VALID_USERS, fmtDate, toast, openModal } from '../utils.js';
import { state, subscribe, saveTasks, logChange } from '../state.js';

let filter = { mine: false, prio: 'all' };

export function renderTasks(root) {
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 05 · drag between columns'),
        h('h1', 'Tasks'),
      ),
    ),
    h('div.view-header-actions',
      h('button.btn.btn-primary', { onclick: () => openTaskModal(null) }, icon('plus'), 'New task'),
    ),
  );

  const filters = h('div.tasks-filters',
    h('div.filter-group',
      h('button.filter-btn' + (!filter.mine ? '.active' : ''), { onclick: () => { filter.mine = false; refresh(); } }, 'All'),
      h('button.filter-btn' + (filter.mine ? '.active' : ''), { onclick: () => { filter.mine = true; refresh(); } }, 'Mine'),
    ),
    h('div.filter-group',
      ...['all','urgent','high','med','low'].map(p =>
        h('button.filter-btn' + (filter.prio === p ? '.active' : ''),
          { onclick: () => { filter.prio = p; refresh(); } }, p === 'all' ? 'Any prio' : p),
      ),
    ),
  );

  const board = h('div.tasks-board');
  const shell = h('div.tasks-shell.view-body.no-pad', filters, board);

  function refresh() {
    // Update filter buttons styling
    filters.querySelectorAll('.filter-group').forEach((grp, idx) => {
      grp.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    });
    filters.children[0].children[filter.mine ? 1 : 0].classList.add('active');
    ['all','urgent','high','med','low'].forEach((p, i) => {
      if (filter.prio === p) filters.children[1].children[i].classList.add('active');
    });
    renderBoard(board);
  }

  refresh();
  root.append(header, shell);
  const unsub = subscribe('tasks', refresh);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}

const PRIO_ORDER = { urgent: 0, high: 1, med: 2, low: 3 };

function filteredTasks() {
  let arr = state.tasks.slice();
  if (filter.mine) arr = arr.filter(t => t.assignee === state.user.name);
  if (filter.prio !== 'all') arr = arr.filter(t => (t.priority || 'med') === filter.prio);
  return arr;
}

function renderBoard(boardEl) {
  boardEl.innerHTML = '';
  const cols = ['todo', 'doing', 'done'];
  const labels = { todo: '# todo', doing: '# in progress', done: '# done' };
  const kanban = h('div.kanban');
  const tasks = filteredTasks();
  cols.forEach(col => {
    const items = tasks.filter(t => t.col === col).sort((a, b) => {
      const ap = PRIO_ORDER[a.priority || 'med'];
      const bp = PRIO_ORDER[b.priority || 'med'];
      if (ap !== bp) return ap - bp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const colEl = h('div.kanban-col', { 'data-col': col,
      ondragover: (e) => { e.preventDefault(); colEl.classList.add('drag-over'); },
      ondragleave: () => colEl.classList.remove('drag-over'),
      ondrop: async (e) => {
        e.preventDefault(); colEl.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const t = state.tasks.find(x => x.id === id);
        if (!t || t.col === col) return;
        t.col = col;
        await saveTasks();
        await logChange('moved a task', `"${t.text}" → ${col}`);
      } },
      h('h4', labels[col], h('span.count', String(items.length))),
      h('div.kanban-list', ...items.map(t => taskCard(t))),
      h('div.kanban-add',
        ((input) => {
          const btn = h('button.btn.btn-primary', { onclick: async () => {
            const text = input.value.trim();
            if (!text) return;
            const tk = { id: uid(), text, col, priority: 'med', createdBy: state.user.name, assignee: state.user.name, createdAt: Date.now() };
            state.tasks.push(tk);
            await saveTasks();
            await logChange('added a task', text);
            input.value = '';
          } }, '+');
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
          return [input, btn];
        })(h('input.input', { placeholder: 'new task...' })),
      ),
    );
    kanban.appendChild(colEl);
  });
  boardEl.appendChild(kanban);
}

function taskCard(t) {
  const overdue = t.due && new Date(t.due) < new Date() && t.col !== 'done';
  const prio = t.priority || 'med';
  const card = h('div.task-card.' + prio + (t.col === 'done' ? '.done' : ''),
    { draggable: true, 'data-id': t.id, onclick: () => openTaskModal(t),
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', t.id); card.classList.add('dragging'); },
      ondragend: () => card.classList.remove('dragging'),
    },
    h('div.task-text', t.text),
    h('div.task-meta',
      h('span.pill' + (prio === 'urgent' ? '.pill-bad' : prio === 'high' ? '.pill-warn' : prio === 'low' ? '.pill-neutral' : ''), prio),
      t.assignee ? h('span', { style: { color: USER_COLORS[t.assignee] } }, t.assignee) : null,
      t.due ? h('span' + (overdue ? '.due.overdue' : '.due'), fmtDate(t.due)) : null,
    ),
  );
  return card;
}

function openTaskModal(existing) {
  const isEdit = !!existing;
  const textInput = h('input.input', { value: existing?.text || '', placeholder: 'What needs doing?' });
  const colSelect = h('select.select');
  ['todo','doing','done'].forEach(c => colSelect.appendChild(h('option', { value: c, selected: (existing?.col || 'todo') === c }, c)));
  const prioSelect = h('select.select');
  ['low','med','high','urgent'].forEach(p => prioSelect.appendChild(h('option', { value: p, selected: (existing?.priority || 'med') === p }, p)));
  const assigneeSelect = h('select.select');
  assigneeSelect.appendChild(h('option', { value: '' }, 'unassigned'));
  VALID_USERS.forEach(u => assigneeSelect.appendChild(h('option', { value: u, selected: existing?.assignee === u }, u)));
  const dueInput = h('input.input', { type: 'date', value: existing?.due || '' });

  const close = openModal(
    h('div.modal',
      h('h2', isEdit ? 'Edit task' : 'New task'),
      h('div.modal-hint', '# something to do'),
      h('div.field', h('label.field-label', 'task'), textInput),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
        h('div.field', h('label.field-label', 'status'), colSelect),
        h('div.field', h('label.field-label', 'priority'), prioSelect),
      ),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
        h('div.field', h('label.field-label', 'assignee'), assigneeSelect),
        h('div.field', h('label.field-label', 'due'), dueInput),
      ),
      h('div.modal-actions',
        isEdit ? h('button.btn.btn-danger', { onclick: async () => {
          state.tasks = state.tasks.filter(t => t.id !== existing.id);
          await saveTasks();
          await logChange('deleted a task', existing.text);
          close();
        } }, 'Delete') : null,
        h('button.btn.btn-ghost', { onclick: close }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: async () => {
          const text = textInput.value.trim();
          if (!text) { toast('Task text required', 'warn'); return; }
          const data = {
            text,
            col: colSelect.value,
            priority: prioSelect.value,
            assignee: assigneeSelect.value || null,
            due: dueInput.value || null,
          };
          if (isEdit) {
            Object.assign(existing, data, { updatedAt: Date.now(), updatedBy: state.user.name });
            await saveTasks();
            await logChange('edited a task', text);
          } else {
            state.tasks.push({ id: uid(), ...data, createdBy: state.user.name, createdAt: Date.now() });
            await saveTasks();
            await logChange('added a task', text);
          }
          close();
        } }, isEdit ? 'Save' : 'Create'),
      ),
    )
  );
  textInput.focus();
}
