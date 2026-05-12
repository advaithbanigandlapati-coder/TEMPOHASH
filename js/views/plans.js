// Plans — higher-level plans/projects.
import { h, icon, esc, uid, fmtDate, openModal, toast } from '../utils.js';
import { state, subscribe, savePlans, logChange } from '../state.js';

export function renderPlans(root) {
  const grid = h('div.plans-grid');
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 06 · currents and intentions'),
        h('h1', 'Plans'),
      ),
    ),
    h('div.view-header-actions',
      h('button.btn.btn-primary', { onclick: () => openPlanModal(null) }, icon('plus'), 'New plan'),
    ),
  );

  function render() {
    grid.innerHTML = '';
    if (!state.plans.length) { grid.appendChild(h('div.empty', h('span.hash', '#'), h('br'), 'No plans yet · the surface is calm')); return; }
    state.plans.forEach(p => {
      grid.appendChild(h('div.card.plan',
        p.tag ? h('span.plan-tag', '# ' + p.tag) : null,
        h('h4', p.title),
        p.desc ? h('p', p.desc) : null,
        h('div.plan-foot',
          h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', '# ' + fmtDate(p.createdAt)),
            h('span', { style: { color: 'var(--dusk)', fontSize: '9px' } }, 'by ' + (p.createdBy || '?')),
          ),
          h('span',
            h('button', { style: { background: 'none', border: 'none', color: 'var(--dusk)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }, onclick: () => openPlanModal(p) }, 'edit'),
            ' · ',
            h('button', { style: { background: 'none', border: 'none', color: 'var(--dusk)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }, onclick: async () => {
              if (!confirm('Delete plan?')) return;
              state.plans = state.plans.filter(x => x.id !== p.id);
              await savePlans();
            } }, 'delete'),
          ),
        ),
      ));
    });
  }

  root.append(header, h('div.view-body', grid));
  render();
  const unsub = subscribe('plans', render);
  root.addEventListener('DOMNodeRemoved', () => unsub(), { once: true });
}

function openPlanModal(existing) {
  const isEdit = !!existing;
  const tag = h('input.input', { value: existing?.tag || '', placeholder: 'e.g. Q3 · Marketing' });
  const title = h('input.input', { value: existing?.title || '', placeholder: 'Plan title' });
  const desc = h('textarea.textarea', { placeholder: 'what does this plan look like?' });
  desc.value = existing?.desc || '';
  const close = openModal(
    h('div.modal',
      h('h2', isEdit ? 'Edit plan' : 'New plan'),
      h('div.modal-hint', '# draft a current'),
      h('div.field', h('label.field-label', 'tag'), tag),
      h('div.field', h('label.field-label', 'title'), title),
      h('div.field', h('label.field-label', 'details'), desc),
      h('div.modal-actions',
        h('button.btn.btn-ghost', { onclick: close }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: async () => {
          const t = title.value.trim();
          if (!t) { toast('Title required', 'warn'); return; }
          const data = { tag: tag.value.trim(), title: t, desc: desc.value.trim() };
          if (isEdit) { Object.assign(existing, data, { updatedAt: Date.now(), updatedBy: state.user.name }); await logChange('edited a plan', t); }
          else { state.plans.unshift({ id: uid(), ...data, createdBy: state.user.name, createdAt: Date.now() }); await logChange('created a plan', t); }
          await savePlans();
          close();
        } }, 'Save'),
      ),
    )
  );
  title.focus();
}
