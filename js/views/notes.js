// Notes — Notion-style hierarchical pages with markdown.
import { h, icon, esc, uid, debounce, toast } from '../utils.js';
import { state, subscribe, saveNotes, logChange } from '../state.js';

const expandedNotes = new Set();

export function renderNotes(root) {
  const shell = h('div.notes-shell.view-body.no-pad');
  const tree = h('div.notes-tree');
  const main = h('div.notes-main');
  shell.append(tree, main);
  root.appendChild(shell);

  function refresh() {
    renderTree(tree);
    renderEditor(main);
  }
  refresh();
  const unsub = subscribe('notes', refresh);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}

function renderTree(treeEl) {
  treeEl.innerHTML = '';
  treeEl.appendChild(h('div.notes-tree-head',
    h('span.title', '# pages'),
    h('button.add', { title: 'New page', onclick: () => createNote(null) }, '+'),
  ));
  // Build tree
  const rootNotes = state.notes.filter(n => !n.parentId);
  if (rootNotes.length === 0) {
    treeEl.appendChild(h('div.empty', { style: { padding: '20px' } }, 'No pages yet'));
    return;
  }
  rootNotes.forEach(n => treeEl.appendChild(renderTreeNode(n, 0)));
}

function renderTreeNode(note, depth) {
  const children = state.notes.filter(n => n.parentId === note.id);
  const hasKids = children.length > 0;
  const expanded = expandedNotes.has(note.id);
  const isActive = state.activeNoteId === note.id;

  const row = h('div.note-tree-item' + (isActive ? '.active' : ''),
    h('span.toggle', {
      onclick: (e) => { e.stopPropagation(); if (hasKids) { if (expanded) expandedNotes.delete(note.id); else expandedNotes.add(note.id); refreshTree(); } },
    }, hasKids ? (expanded ? '▾' : '▸') : '·'),
    h('span.icon', '📄'),
    h('span.label', { onclick: () => { state.activeNoteId = note.id; refreshTree(); refreshEditor(); } }, note.title || 'Untitled'),
    h('div.actions',
      h('button', { title: 'Add child', onclick: (e) => { e.stopPropagation(); createNote(note.id); } }, '+'),
      h('button', { title: 'Delete', onclick: (e) => { e.stopPropagation(); deleteNote(note); } }, '×'),
    ),
  );

  const wrap = h('div', { style: { paddingLeft: depth ? '12px' : '0' } }, row);
  if (expanded && hasKids) {
    wrap.appendChild(h('div.note-tree-children', ...children.map(c => renderTreeNode(c, depth + 1))));
  }
  return wrap;
}

function refreshTree() {
  const treeEl = document.querySelector('.notes-tree');
  if (treeEl) renderTree(treeEl);
}
function refreshEditor() {
  const mainEl = document.querySelector('.notes-main');
  if (mainEl) renderEditor(mainEl);
}

function renderEditor(mainEl) {
  mainEl.innerHTML = '';
  const note = state.notes.find(n => n.id === state.activeNoteId);
  if (!note) {
    mainEl.appendChild(h('div.empty', { style: { padding: '80px 20px' } },
      h('span.hash', '·'), h('br'),
      'Select a page or create one'
    ));
    return;
  }

  // Crumbs
  const crumbs = [];
  let cur = note;
  while (cur) {
    crumbs.unshift(cur.title || 'Untitled');
    cur = cur.parentId ? state.notes.find(n => n.id === cur.parentId) : null;
  }

  const titleInput = h('input.notes-title-input', { value: note.title || '', placeholder: 'Untitled' });
  const savedIndicator = h('div.notes-saved', 'Saved');

  const head = h('div.notes-head',
    h('div.notes-head-left',
      h('div.crumbs', crumbs.join(' / ')),
      titleInput,
    ),
    savedIndicator,
  );

  const editorTextarea = h('textarea', {
    placeholder: 'Start writing in markdown...\n\n# Heading 1\n## Heading 2\n- bullet\n**bold** *italic* `code`',
    value: note.body || '',
  });
  const editor = h('div.notes-editor', editorTextarea);
  const preview = h('div.notes-preview');
  function renderPreview() {
    try {
      preview.innerHTML = window.marked ? window.marked.parse(note.body || '') : esc(note.body || '');
    } catch {
      preview.innerHTML = esc(note.body || '');
    }
  }
  renderPreview();

  const body = h('div.notes-body', editor, preview);
  mainEl.append(head, body);

  // Auto-save debounced
  const saveDebounced = debounce(async () => {
    note.updatedAt = Date.now();
    note.updatedBy = state.user.name;
    savedIndicator.textContent = 'Saving...';
    savedIndicator.classList.add('saving');
    await saveNotes();
    savedIndicator.textContent = 'Saved';
    savedIndicator.classList.remove('saving');
  }, 600);

  titleInput.addEventListener('input', () => {
    note.title = titleInput.value;
    saveDebounced();
    // Update tree
    const treeItem = document.querySelector('.note-tree-item.active .label');
    if (treeItem) treeItem.textContent = note.title || 'Untitled';
  });

  editorTextarea.addEventListener('input', () => {
    note.body = editorTextarea.value;
    renderPreview();
    saveDebounced();
  });
}

async function createNote(parentId) {
  const note = {
    id: uid(),
    parentId: parentId || null,
    title: '',
    body: '',
    createdBy: state.user.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.notes.push(note);
  if (parentId) expandedNotes.add(parentId);
  state.activeNoteId = note.id;
  await saveNotes();
  await logChange('created a page', '');
  refreshTree();
  refreshEditor();
  setTimeout(() => {
    const t = document.querySelector('.notes-title-input');
    if (t) t.focus();
  }, 50);
}

async function deleteNote(note) {
  const kids = state.notes.filter(n => n.parentId === note.id);
  const total = 1 + countDescendants(note.id);
  if (!confirm(`Delete "${note.title || 'Untitled'}"${total > 1 ? ` and ${total - 1} child page${total > 2 ? 's' : ''}` : ''}?`)) return;
  // Delete recursively
  const toDelete = new Set();
  function gather(id) { toDelete.add(id); state.notes.filter(n => n.parentId === id).forEach(c => gather(c.id)); }
  gather(note.id);
  state.notes = state.notes.filter(n => !toDelete.has(n.id));
  if (toDelete.has(state.activeNoteId)) state.activeNoteId = null;
  await saveNotes();
  await logChange('deleted a page', note.title || 'Untitled');
  refreshTree();
  refreshEditor();
}

function countDescendants(id) {
  return state.notes.filter(n => n.parentId === id).reduce((acc, c) => acc + 1 + countDescendants(c.id), 0);
}
