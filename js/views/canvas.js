// Canvas — multi-user drawing with live cursors and sticky notes.
import { h, icon, esc, uid, debounce, throttle, USER_COLORS } from '../utils.js';
import { state, subscribe, canvasChannel, saveCanvasStrokes, saveCanvasNotes, logChange } from '../state.js';

let canvasTool = 'pen', canvasColor = '#22d3ee', canvasSize = 3;
let drawing = false, currentStroke = null;
const remoteCursors = new Map();
const remoteInProgress = new Map();

export function renderCanvas(root) {
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 09 · draw together'),
        h('h1', 'Canvas'),
      ),
    ),
  );
  const toolbar = h('div.canvas-toolbar',
    h('div.group',
      h('span.label', 'tool'),
      h('button.tool-btn.active', { 'data-tool': 'pen', onclick: (e) => setTool('pen', e.target) }, 'pen'),
      h('button.tool-btn', { 'data-tool': 'eraser', onclick: (e) => setTool('eraser', e.target) }, 'eraser'),
    ),
    h('div.divider'),
    h('div.group',
      h('span.label', 'color'),
      h('div.swatches',
        ...['#22d3ee','#60a5fa','#93c5fd','#f1f5f9','#fbbf24','#f472b6'].map(c =>
          h('div.swatch' + (c === canvasColor ? '.active' : ''), { style: { background: c }, 'data-color': c, onclick: (e) => setColor(c, e.target) })
        ),
      ),
    ),
    h('div.divider'),
    h('div.group',
      h('span.label', 'size'),
      ((sl) => { sl.addEventListener('input', () => { canvasSize = parseInt(sl.value, 10); }); return sl; })(
        h('input', { type: 'range', min: '1', max: '40', value: String(canvasSize), style: { width: '80px' } })
      ),
    ),
    h('div.divider'),
    h('div.group',
      h('button.tool-btn', { onclick: addSticky }, '+ sticky'),
      h('button.tool-btn', { onclick: clearAll }, 'clear'),
    ),
    h('div.canvas-online', { id: 'canvasOnlineUsers' }),
  );

  const canvasEl = h('canvas', { id: 'sketchCanvas' });
  const stickyOverlay = h('div.sticky-overlay', { id: 'stickyOverlay' });
  const cursorsOverlay = h('div.cursors-overlay', { id: 'cursorsOverlay' });
  const wrap = h('div.canvas-wrap', { id: 'canvasWrap' }, canvasEl, stickyOverlay, cursorsOverlay);

  const shell = h('div.canvas-shell.view-body.no-pad', toolbar, wrap);
  root.append(header, shell);

  const ctx = canvasEl.getContext('2d');

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = rect.width + 'px';
    canvasEl.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  function redraw() {
    const rect = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.canvasStrokes.forEach(s => drawStroke(s, rect));
  }

  function drawStroke(s, rect) {
    if (!s.points || !s.points.length) return;
    ctx.beginPath();
    if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; }
    ctx.lineWidth = s.size;
    s.points.forEach((p, i) => {
      const x = p[0] * rect.width, y = p[1] * rect.height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (s.points.length === 1) {
      const x = s.points[0][0] * rect.width, y = s.points[0][1] * rect.height;
      ctx.lineTo(x + 0.1, y + 0.1);
    }
    ctx.stroke();
  }

  function normPoint(e) {
    const rect = canvasEl.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  const broadcastCursor = throttle((x, y) => {
    canvasChannel?.send({ type: 'broadcast', event: 'cursor', payload: { user: state.user.name, color: state.user.color, x, y } });
  }, 40);

  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drawing = true; try { canvasEl.setPointerCapture(e.pointerId); } catch {}
    currentStroke = { id: uid(), tool: canvasTool, color: canvasColor, size: canvasSize, points: [normPoint(e)] };
    drawStroke(currentStroke, wrap.getBoundingClientRect());
    canvasChannel?.send({ type: 'broadcast', event: 'stroke_start', payload: { id: currentStroke.id, tool: canvasTool, color: canvasColor, size: canvasSize, point: currentStroke.points[0], user: state.user.name } });
  });
  canvasEl.addEventListener('pointermove', (e) => {
    const p = normPoint(e);
    broadcastCursor(p[0], p[1]);
    if (!drawing || !currentStroke) return;
    const last = currentStroke.points[currentStroke.points.length - 1];
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if (dx * dx + dy * dy < 0.000002) return;
    currentStroke.points.push(p);
    const rect = wrap.getBoundingClientRect();
    ctx.beginPath();
    if (currentStroke.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = currentStroke.color; }
    ctx.lineWidth = currentStroke.size;
    ctx.moveTo(last[0] * rect.width, last[1] * rect.height);
    ctx.lineTo(p[0] * rect.width, p[1] * rect.height);
    ctx.stroke();
    canvasChannel?.send({ type: 'broadcast', event: 'stroke_point', payload: { id: currentStroke.id, point: p } });
  });

  const saveStrokesDeb = debounce(saveCanvasStrokes, 350);
  function endStroke() {
    if (!drawing || !currentStroke) return;
    drawing = false;
    canvasChannel?.send({ type: 'broadcast', event: 'stroke_end', payload: { id: currentStroke.id, stroke: currentStroke } });
    state.canvasStrokes.push(currentStroke);
    currentStroke = null;
    saveStrokesDeb();
  }
  canvasEl.addEventListener('pointerup', endStroke);
  canvasEl.addEventListener('pointercancel', endStroke);
  canvasEl.addEventListener('pointerleave', endStroke);

  // Subscribe to canvas broadcasts
  if (canvasChannel) {
    canvasChannel.on('broadcast', { event: 'cursor' }, (m) => handleRemoteCursor(m.payload, wrap, cursorsOverlay));
    canvasChannel.on('broadcast', { event: 'stroke_start' }, (m) => handleRemoteStart(m.payload, wrap, ctx));
    canvasChannel.on('broadcast', { event: 'stroke_point' }, (m) => handleRemotePoint(m.payload, wrap, ctx));
    canvasChannel.on('broadcast', { event: 'stroke_end' }, (m) => handleRemoteEnd(m.payload));
  }

  function setTool(t, el) {
    canvasTool = t;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    wrap.classList.toggle('eraser', t === 'eraser');
  }
  function setColor(c, el) {
    canvasColor = c; canvasTool = 'pen';
    toolbar.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('active', b.dataset.color === c));
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));
    wrap.classList.remove('eraser');
  }
  async function clearAll() {
    if (!confirm('Clear canvas for everyone?')) return;
    state.canvasStrokes = [];
    await saveCanvasStrokes();
    await logChange('cleared the canvas', '');
    redraw();
  }

  function renderStickies() {
    stickyOverlay.innerHTML = '';
    state.canvasNotes.forEach(n => {
      const color = n.color || '#22d3ee';
      function hex2rgba(h, a) { const x = h.replace('#',''); return `rgba(${parseInt(x.slice(0,2),16)},${parseInt(x.slice(2,4),16)},${parseInt(x.slice(4,6),16)},${a})`; }
      const note = h('div.sticky', { 'data-id': n.id, style: { left: (n.x * 100) + '%', top: (n.y * 100) + '%', background: hex2rgba(color, 0.18), border: '1px solid ' + hex2rgba(color, 0.7), color } },
        h('div.sticky-header',
          h('span.sticky-who', n.createdBy || '?'),
          h('button.sticky-del', { onclick: async () => { state.canvasNotes = state.canvasNotes.filter(x => x.id !== n.id); await saveCanvasNotes(); renderStickies(); } }, '✕'),
        ),
        ((ta) => {
          const saveNotesDeb = debounce(saveCanvasNotes, 500);
          ta.addEventListener('input', () => { n.text = ta.value; saveNotesDeb(); });
          return ta;
        })(h('textarea', { value: n.text || '', placeholder: 'write...' })),
      );
      // Drag
      const header = note.querySelector('.sticky-header');
      header.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const overlayRect = stickyOverlay.getBoundingClientRect();
        const elRect = note.getBoundingClientRect();
        const grabX = e.clientX - elRect.left, grabY = e.clientY - elRect.top;
        function move(ev) {
          const nx = Math.max(0, Math.min(1 - elRect.width / overlayRect.width, (ev.clientX - grabX - overlayRect.left) / overlayRect.width));
          const ny = Math.max(0, Math.min(1 - elRect.height / overlayRect.height, (ev.clientY - grabY - overlayRect.top) / overlayRect.height));
          note.style.left = (nx * 100) + '%';
          note.style.top = (ny * 100) + '%';
          n.x = nx; n.y = ny;
        }
        function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveCanvasNotes(); }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      stickyOverlay.appendChild(note);
    });
  }

  async function addSticky() {
    const colors = ['#22d3ee','#60a5fa','#fbbf24','#34d399','#f472b6','#a78bfa'];
    state.canvasNotes.push({
      id: uid(), x: 0.35 + Math.random() * 0.1, y: 0.30 + Math.random() * 0.1,
      text: '', color: colors[Math.floor(Math.random() * colors.length)],
      createdBy: state.user.name, createdAt: Date.now(),
    });
    await saveCanvasNotes();
    await logChange('added a sticky note', '');
    renderStickies();
  }

  setupCanvas();
  redraw();
  renderStickies();
  const ro = new ResizeObserver(() => { setupCanvas(); redraw(); });
  ro.observe(wrap);

  const unsub1 = subscribe('canvas', redraw);
  const unsub2 = subscribe('canvasNotes', renderStickies);
  root.addEventListener('DOMNodeRemoved', () => { unsub1(); unsub2(); ro.disconnect(); }, { once: true });
}

function handleRemoteCursor({ user, color, x, y }, wrap, overlay) {
  if (user === state.user.name) return;
  const rect = wrap.getBoundingClientRect();
  if (!rect.width) return;
  let el = remoteCursors.get(user);
  if (!el) {
    el = h('div.remote-cursor',
      { html: `<svg class="cursor-arrow" viewBox="0 0 16 20" fill="${color}"><path d="M0 0L0 16L4.5 11.5L7 18L9 17L6.5 10.5L12 10.5Z"/></svg><span class="cursor-label" style="background:${color}">${esc(user)}</span>` }
    );
    overlay.appendChild(el);
    remoteCursors.set(user, el);
  }
  clearTimeout(el._timeout);
  el.style.transform = `translate(${x * rect.width}px, ${y * rect.height}px)`;
  el._timeout = setTimeout(() => { el.remove(); remoteCursors.delete(user); }, 5000);
}
function handleRemoteStart({ id, tool, color, size, point, user }, wrap, ctx) {
  if (user === state.user.name) return;
  remoteInProgress.set(id, { tool, color, size, points: [point] });
  const rect = wrap.getBoundingClientRect();
  ctx.beginPath();
  if (tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = color; }
  ctx.lineWidth = size;
  ctx.moveTo(point[0] * rect.width, point[1] * rect.height);
  ctx.lineTo(point[0] * rect.width + 0.1, point[1] * rect.height + 0.1);
  ctx.stroke();
}
function handleRemotePoint({ id, point }, wrap, ctx) {
  const s = remoteInProgress.get(id); if (!s) return;
  const last = s.points[s.points.length - 1]; s.points.push(point);
  const rect = wrap.getBoundingClientRect();
  ctx.beginPath();
  if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; }
  ctx.lineWidth = s.size;
  ctx.moveTo(last[0] * rect.width, last[1] * rect.height);
  ctx.lineTo(point[0] * rect.width, point[1] * rect.height);
  ctx.stroke();
}
function handleRemoteEnd({ id, stroke }) {
  remoteInProgress.delete(id);
  if (stroke && !state.canvasStrokes.find(s => s.id === id)) state.canvasStrokes.push(stroke);
}
