// Calendar — month / week / day views.
import { h, icon, esc, fmtTime, dateKey, sameDay, isToday, uid, USER_COLORS, toast } from '../utils.js';
import { state, subscribe, saveCalendar, logChange } from '../state.js';

let calView = 'month'; // 'month' | 'week' | 'day'
let cursor = new Date();

export function renderCalendar(root) {
  cursor = new Date();
  const shell = h('div.cal-shell.view-body.no-pad');
  const toolbar = h('div.cal-toolbar');
  const body = h('div.cal-body');
  shell.append(toolbar, body);
  root.appendChild(shell);

  function refresh() {
    renderToolbar(toolbar, refresh, body, refresh);
    renderBody(body);
  }
  refresh();
  const unsub = subscribe('calendar', refresh);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}

function renderToolbar(toolbar, refresh, body) {
  toolbar.innerHTML = '';
  toolbar.append(
    h('div.nav-btns',
      h('button', { onclick: () => { navigate(-1); refresh(); } }, '‹'),
      h('button', { onclick: () => { cursor = new Date(); refresh(); } }, 'Today'),
      h('button', { onclick: () => { navigate(1); refresh(); } }, '›'),
    ),
    h('div.cal-title', titleForView()),
    h('button.btn.btn-primary.btn-sm', { onclick: () => openEventModal(null, null), style: { marginLeft: 'auto' } }, icon('plus'), 'New event'),
    h('div.view-switch',
      h('button' + (calView === 'month' ? '.active' : ''), { onclick: () => { calView = 'month'; refresh(); } }, 'Month'),
      h('button' + (calView === 'week' ? '.active' : ''), { onclick: () => { calView = 'week'; refresh(); } }, 'Week'),
      h('button' + (calView === 'day' ? '.active' : ''), { onclick: () => { calView = 'day'; refresh(); } }, 'Day'),
    ),
  );
}

function navigate(dir) {
  if (calView === 'month') cursor.setMonth(cursor.getMonth() + dir);
  else if (calView === 'week') cursor.setDate(cursor.getDate() + dir * 7);
  else cursor.setDate(cursor.getDate() + dir);
}

function titleForView() {
  if (calView === 'month') return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (calView === 'day') return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // week
  const start = new Date(cursor); start.setDate(start.getDate() - start.getDay());
  const end = new Date(start); end.setDate(end.getDate() + 6);
  if (start.getMonth() === end.getMonth()) return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${start.toLocaleDateString('en-US', { month: 'short' })} – ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

function renderBody(body) {
  body.innerHTML = '';
  if (calView === 'month') body.appendChild(renderMonth());
  else if (calView === 'day') body.appendChild(renderWeekOrDay(true));
  else body.appendChild(renderWeekOrDay(false));
}

function renderMonth() {
  const wrap = h('div.cal-month');
  const dowRow = h('div.cal-month-dows');
  ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach(d => dowRow.appendChild(h('div.dow', d)));
  wrap.appendChild(dowRow);

  const grid = h('div.cal-month-grid');
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevLast = new Date(year, month, 0).getDate();

  // Leading days (prev month)
  for (let i = startWeekday - 1; i >= 0; i--) {
    grid.appendChild(monthDayCell(new Date(year, month - 1, prevLast - i), true));
  }
  // This month
  for (let d = 1; d <= daysInMonth; d++) {
    grid.appendChild(monthDayCell(new Date(year, month, d), false));
  }
  // Trailing
  const total = startWeekday + daysInMonth;
  const trailing = (7 - (total % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    grid.appendChild(monthDayCell(new Date(year, month + 1, d), true));
  }

  wrap.appendChild(grid);
  return wrap;
}

function monthDayCell(d, otherMonth) {
  const dk = dateKey(d);
  const events = state.events.filter(e => e.date === dk).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const cell = h('div.cal-month-day' + (otherMonth ? '.other-month' : '') + (isToday(d) ? '.today' : ''),
    { onclick: (ev) => { if (ev.target === cell || ev.target.classList.contains('day-num') || ev.target.classList.contains('day-events')) openEventModal(null, dk); } },
    h('span.day-num', String(d.getDate())),
  );
  const eventsWrap = h('div.day-events');
  for (let i = 0; i < Math.min(3, events.length); i++) {
    const e = events[i];
    const color = USER_COLORS[e.createdBy] || '#22d3ee';
    eventsWrap.appendChild(h('div.month-event',
      { style: { borderLeftColor: color, background: color + '22' },
        onclick: (ev) => { ev.stopPropagation(); openEventModal(e, dk); } },
      e.time ? h('span', { style: { fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--dusk)', marginRight: '4px' } }, e.time.slice(0,5)) : null,
      e.title
    ));
  }
  if (events.length > 3) {
    eventsWrap.appendChild(h('div.month-event-more', `+ ${events.length - 3} more`));
  }
  cell.appendChild(eventsWrap);
  return cell;
}

function renderWeekOrDay(dayOnly) {
  const wrap = h('div.cal-week');
  const head = h('div.cal-week-head' + (dayOnly ? '.day-view' : ''));
  head.appendChild(h('div.gutter'));

  let days;
  if (dayOnly) {
    days = [new Date(cursor)];
  } else {
    const start = new Date(cursor); start.setDate(start.getDate() - start.getDay());
    days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  }
  days.forEach(d => {
    head.appendChild(h('div.day-col' + (isToday(d) ? '.today' : ''),
      h('div.dow', d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()),
      h('div.dnum', String(d.getDate())),
    ));
  });

  const bodyEl = h('div.cal-week-body' + (dayOnly ? '.day-view' : ''));
  // Hours column
  const hoursCol = h('div.cal-week-hours');
  for (let hr = 0; hr < 24; hr++) {
    hoursCol.appendChild(h('div.hour', hr === 0 ? '' : (hr < 12 ? `${hr} AM` : hr === 12 ? '12 PM' : `${hr - 12} PM`)));
  }
  bodyEl.appendChild(hoursCol);

  days.forEach(d => bodyEl.appendChild(renderDayColumn(d)));

  wrap.append(head, bodyEl);
  return wrap;
}

function renderDayColumn(d) {
  const col = h('div.cal-week-col');
  // 24 slot rows
  for (let hr = 0; hr < 24; hr++) {
    const slot = h('div.slot', { onclick: () => openEventModal(null, dateKey(d), `${String(hr).padStart(2, '0')}:00`) });
    col.appendChild(slot);
  }
  // Events overlaid by absolute positioning
  const dk = dateKey(d);
  const events = state.events.filter(e => e.date === dk);
  events.forEach(e => {
    if (!e.time) return;
    const [hh, mm] = e.time.split(':').map(Number);
    const top = (hh + mm / 60) * 48; // 48px per hour
    const dur = e.duration || 60; // minutes
    const height = Math.max(20, (dur / 60) * 48);
    const color = USER_COLORS[e.createdBy] || '#22d3ee';
    col.appendChild(h('div.week-event',
      { style: { top: top + 'px', height: height + 'px', background: color + '33', borderLeftColor: color },
        onclick: () => openEventModal(e, dk) },
      h('div.title', e.title),
      h('div.time', e.time + (e.duration ? ` · ${dur}m` : '')),
    ));
  });
  // Now line if today
  if (isToday(d)) {
    const now = new Date();
    const top = (now.getHours() + now.getMinutes() / 60) * 48;
    col.appendChild(h('div.now-line', { style: { top: top + 'px' } }));
  }
  return col;
}

// ===== Event modal =====
import { openModal } from '../utils.js';
function openEventModal(existing, date, time) {
  const isEdit = !!existing;
  const titleInput = h('input.input', { value: existing?.title || '', placeholder: 'Event title' });
  const dateInput = h('input.input', { type: 'date', value: existing?.date || date || dateKey(new Date()) });
  const timeInput = h('input.input', { type: 'time', value: existing?.time || time || '' });
  const durInput = h('input.input', { type: 'number', min: '15', step: '15', value: String(existing?.duration || 60), placeholder: 'mins' });
  const descInput = h('textarea.textarea', { placeholder: 'Details (optional)' });
  descInput.value = existing?.desc || '';

  const close = openModal(
    h('div.modal',
      h('h2', isEdit ? 'Edit event' : 'New event'),
      h('div.modal-hint', '# block out time'),
      h('div.field', h('label.field-label', 'title'), titleInput),
      h('div.field', h('label.field-label', 'date'), dateInput),
      h('div.field', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
        h('div', h('label.field-label', 'start time'), timeInput),
        h('div', h('label.field-label', 'duration (min)'), durInput),
      ),
      h('div.field', h('label.field-label', 'details'), descInput),
      h('div.modal-actions',
        isEdit ? h('button.btn.btn-danger', { onclick: async () => {
          state.events = state.events.filter(e => e.id !== existing.id);
          await saveCalendar();
          await logChange('deleted an event', existing.title);
          close();
        } }, 'Delete') : null,
        h('button.btn.btn-ghost', { onclick: close }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Title required', 'warn'); return; }
          const data = {
            title,
            date: dateInput.value,
            time: timeInput.value,
            duration: parseInt(durInput.value, 10) || 60,
            desc: descInput.value.trim(),
            createdBy: state.user.name,
          };
          if (isEdit) {
            Object.assign(existing, data, { updatedAt: Date.now(), updatedBy: state.user.name });
            await saveCalendar();
            await logChange('edited an event', title);
          } else {
            state.events.push({ id: uid(), ...data, createdAt: Date.now() });
            await saveCalendar();
            await logChange('added an event', `${title} on ${data.date}`);
          }
          close();
        } }, isEdit ? 'Save' : 'Create'),
      ),
    )
  );
  titleInput.focus();
}
