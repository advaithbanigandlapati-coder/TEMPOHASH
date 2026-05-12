// Channels view — chat with mentions, reactions, threads, DMs.
import { h, icon, avatar, esc, fmtTime, fmtDate, sameDay, uid, throttle, USER_COLORS, VALID_USERS, toast } from '../utils.js';
import { state, subscribe, saveChannelMessages, saveChannels, markRead, broadcastTyping, logChange } from '../state.js';
import { saveKey, loadKey } from '../api.js';

const typingTimers = new Map();

export function renderChannels(root) {
  // Default to general if nothing selected
  if (!state.activeChannel) state.activeChannel = state.channels[0]?.id || 'general';

  const shell = h('div.channels-shell.view-body.no-pad');
  const rail = h('div.channels-rail');
  const main = h('div.channel-main');
  shell.append(rail, main);
  root.appendChild(shell);

  // If we landed on a DM directly (e.g. from sidebar), load its messages
  if (state.activeChannel.startsWith('dm:')) {
    ensureDmLoaded(state.activeChannel).then(() => renderMain());
  }

  function buildRail() {
    rail.innerHTML = '';
    // Channels section
    rail.appendChild(h('div.channels-section',
      h('div.channels-section-head',
        h('span.title', '# channels'),
        h('button.add-btn', { title: 'New channel', onclick: createChannelPrompt }, '+'),
      ),
      ...state.channels.map(ch => {
        const unread = state.unread.get(ch.id) || 0;
        const isActive = state.activeChannel === ch.id;
        return h('div.channel-item' + (isActive ? '.active' : '') + (unread > 0 ? '.unread' : ''),
          { onclick: () => { state.activeChannel = ch.id; markRead(ch.id); renderMain(); buildRail(); } },
          h('span.ci-hash', '#'),
          h('span.ci-name', ch.name),
          unread > 0 ? h('span.ci-badge', String(unread)) : null,
        );
      }),
    ));
    // DMs section
    rail.appendChild(h('div.channels-section',
      h('div.channels-section-head',
        h('span.title', '# direct messages'),
      ),
      ...VALID_USERS.filter(u => u !== state.user.name).map(u => {
        const dmId = 'dm:' + [state.user.name, u].sort().join('_');
        const isActive = state.activeChannel === dmId;
        const presence = state.presence.get(u);
        const isOnline = presence && (presence.status === 'online' || presence.status === 'focusing');
        const unread = state.unread.get(dmId) || 0;
        return h('div.channel-item' + (isActive ? '.active' : '') + (unread > 0 ? '.unread' : ''),
          { onclick: async () => { state.activeChannel = dmId; markRead(dmId); await ensureDmLoaded(dmId); renderMain(); buildRail(); } },
          h('span.ci-presence' + (isOnline ? '.online' : ''),
            presence?.status === 'focusing' ? { style: { background: '#a78bfa', boxShadow: '0 0 4px #a78bfa' } } : null
          ),
          h('span.ci-name', u),
          unread > 0 ? h('span.ci-badge', String(unread)) : null,
        );
      }),
    ));
  }

  function renderMain() {
    main.innerHTML = '';
    const chId = state.activeChannel;
    const isDm = chId.startsWith('dm:');
    let ch;
    if (isDm) {
      const dmRaw = chId.slice(3);
      const [u1, u2] = dmRaw.split('_');
      const other = u1 === state.user.name ? u2 : u1;
      ch = { id: chId, name: other, topic: 'Direct message', isDm: true, other };
    } else {
      ch = state.channels.find(c => c.id === chId);
      if (!ch) { main.appendChild(h('div.empty', 'Channel not found')); return; }
    }
    markRead(chId);

    const header = h('div.channel-header',
      h('div.channel-header-title',
        h('span.h', ch.isDm ? '@' : '#'),
        h('h2', ch.name),
        ch.topic ? h('span.topic', ch.topic) : null,
      ),
      h('div', { style: { display: 'flex', gap: '6px' } },
        h('button.btn.btn-ghost.btn-sm', { onclick: () => window.tempoNav.go('video'), title: 'Start a call' }, icon('video')),
      ),
    );

    const messagesEl = h('div.channel-messages');
    const typingEl = h('div.composer-typing');
    const composer = buildComposer(chId, typingEl);
    main.append(header, messagesEl, h('div.channel-composer', composer, typingEl));

    renderMessages(messagesEl, chId);

    // Subscribe to message changes
    const unsub = subscribe('messages:' + chId, () => renderMessages(messagesEl, chId));
    const unsub2 = subscribe('typing', (payload) => {
      if (payload.channelId !== chId || payload.user === state.user.name) return;
      const set = typingTimers.get(chId) || new Set();
      set.add(payload.user);
      typingTimers.set(chId, set);
      updateTypingIndicator(typingEl, chId);
      setTimeout(() => {
        const cur = typingTimers.get(chId);
        if (cur) { cur.delete(payload.user); updateTypingIndicator(typingEl, chId); }
      }, 3500);
    });

    main.addEventListener('DOMNodeRemoved', () => { unsub(); unsub2(); }, { once: true });

    // Scroll to bottom
    setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 10);
  }

  buildRail();
  renderMain();
}

function updateTypingIndicator(el, chId) {
  const set = typingTimers.get(chId);
  if (!set || set.size === 0) { el.textContent = ''; return; }
  const names = Array.from(set);
  if (names.length === 1) el.textContent = `${names[0]} is typing...`;
  else if (names.length === 2) el.textContent = `${names[0]} and ${names[1]} are typing...`;
  else el.textContent = 'several people are typing...';
}

async function ensureDmLoaded(dmId) {
  const key = 'tempo:dm:' + dmId.slice(3);
  if (!state.channelMessages.has(dmId)) {
    const msgs = await loadKey(key, []);
    state.channelMessages.set(dmId, msgs);
  }
}

function renderMessages(container, chId) {
  container.innerHTML = '';
  const msgs = state.channelMessages.get(chId) || [];
  if (msgs.length === 0) {
    container.appendChild(h('div.empty', { style: { padding: '40px 20px' } },
      h('span.hash', '#'), h('br'),
      'No messages yet — say hello.'
    ));
    return;
  }

  let lastDay = null;
  let lastUser = null;
  let lastTs = 0;

  for (const m of msgs) {
    const msgDate = new Date(m.ts);
    // Day divider
    if (!lastDay || !sameDay(lastDay, msgDate)) {
      container.appendChild(h('div.msg-day-divider', formatDay(msgDate)));
      lastDay = msgDate;
      lastUser = null;
    }
    // Continuation if same user within 5 min
    const isContinuation = lastUser === m.user && (m.ts - lastTs) < 5 * 60 * 1000;
    container.appendChild(renderMessageRow(m, chId, isContinuation));
    lastUser = m.user;
    lastTs = m.ts;
  }
  // Scroll if near bottom
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function formatDay(d) {
  const now = new Date();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function renderMessageRow(m, chId, isContinuation) {
  const color = m.color || USER_COLORS[m.user] || '#94a3b8';
  const av = h('div.av-content',
    h('div.avatar', { style: { background: `linear-gradient(135deg, ${color}, ${color}88)` } },
      m.user.slice(0, 2).toUpperCase())
  );
  const row = h('div.msg' + (isContinuation ? '.continuation' : ''), { 'data-msg-id': m.id, 'data-time': fmtTime(m.ts) });
  row.appendChild(h('div.msg-avatar', { 'data-time': fmtTime(m.ts) }, av));

  const body = h('div.msg-body');
  if (!isContinuation) {
    body.appendChild(h('div.msg-header',
      h('span.msg-user', { style: { color } }, m.user),
      h('span.msg-time', fmtTime(m.ts)),
    ));
  }
  body.appendChild(renderMessageContent(m));
  body.appendChild(renderReactions(m, chId));
  if (m.threadCount > 0) {
    body.appendChild(h('div.msg-thread-link', { onclick: () => openThread(m.id, chId) },
      icon('thread'),
      `${m.threadCount} ${m.threadCount === 1 ? 'reply' : 'replies'}`,
    ));
  }
  row.appendChild(body);

  // Hover actions
  const actions = h('div.msg-actions',
    h('button', { title: 'React', onclick: () => addReactionPrompt(m, chId) }, icon('smile')),
    h('button', { title: 'Reply in thread', onclick: () => openThread(m.id, chId) }, icon('thread')),
    m.user === state.user.name
      ? h('button', { title: 'Edit', onclick: () => editMessage(m, chId) }, icon('edit'))
      : null,
    m.user === state.user.name
      ? h('button.danger', { title: 'Delete', onclick: () => deleteMessage(m, chId) }, icon('trash'))
      : null,
  );
  row.appendChild(actions);

  return row;
}

function renderMessageContent(m) {
  const textEl = h('div.msg-text');
  textEl.innerHTML = formatMessageText(m.text);
  if (m.edited) textEl.appendChild(h('span.msg-edited', ' (edited)'));
  return textEl;
}

function formatMessageText(text) {
  // Escape, then apply markup
  let s = esc(text);
  // Mentions
  s = s.replace(/@(Aakshat|Advaith|Abhi|Nivas)\b/g, '<span class="mention">@$1</span>');
  // Triple-backtick code blocks
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // URLs
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}

function renderReactions(m, chId) {
  if (!m.reactions || Object.keys(m.reactions).length === 0) return h('span');
  const wrap = h('div.msg-reactions');
  for (const [emoji, users] of Object.entries(m.reactions)) {
    if (!users.length) continue;
    const mine = users.includes(state.user.name);
    wrap.appendChild(h('div.reaction' + (mine ? '.mine' : ''),
      { onclick: () => toggleReaction(m, chId, emoji) },
      h('span', emoji),
      h('span.count', String(users.length)),
    ));
  }
  return wrap;
}

async function toggleReaction(msg, chId, emoji) {
  msg.reactions = msg.reactions || {};
  const arr = msg.reactions[emoji] || [];
  const me = state.user.name;
  if (arr.includes(me)) {
    msg.reactions[emoji] = arr.filter(u => u !== me);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
  } else {
    arr.push(me);
    msg.reactions[emoji] = arr;
  }
  await saveMsgs(chId);
}

function addReactionPrompt(msg, chId) {
  const emojis = ['👍','❤️','🔥','😂','🎉','🙏','👀','✅'];
  const pop = h('div.reaction-picker', { style: { position: 'fixed', zIndex: 200, background: 'rgba(13,25,55,0.95)', border: '1px solid rgba(34,211,238,0.45)', borderRadius: '10px', padding: '6px', display: 'flex', gap: '4px', boxShadow: '0 8px 24px rgba(2,6,23,0.6)', backdropFilter: 'blur(20px)' } });
  emojis.forEach(e => {
    pop.appendChild(h('button', { style: { background: 'none', border: 'none', fontSize: '18px', padding: '4px 6px', cursor: 'pointer', borderRadius: '6px' }, onclick: async () => { await toggleReaction(msg, chId, e); pop.remove(); } }, e));
  });
  document.body.appendChild(pop);
  // Position near mouse / center
  const rect = document.querySelector(`[data-msg-id="${msg.id}"]`)?.getBoundingClientRect();
  if (rect) {
    pop.style.left = (rect.right - 200) + 'px';
    pop.style.top = (rect.top - 40) + 'px';
  } else {
    pop.style.left = '40%';
    pop.style.top = '40%';
  }
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close); }
    });
  }, 10);
}

async function deleteMessage(msg, chId) {
  if (!confirm('Delete this message?')) return;
  const msgs = state.channelMessages.get(chId) || [];
  const filtered = msgs.filter(m => m.id !== msg.id);
  state.channelMessages.set(chId, filtered);
  await saveMsgs(chId);
}

async function editMessage(msg, chId) {
  const newText = prompt('Edit message:', msg.text);
  if (newText === null || newText === msg.text) return;
  msg.text = newText.trim();
  msg.edited = true;
  msg.editedAt = Date.now();
  await saveMsgs(chId);
}

async function saveMsgs(chId) {
  if (chId.startsWith('dm:')) {
    const dmRaw = chId.slice(3);
    await saveKey('tempo:dm:' + dmRaw, state.channelMessages.get(chId) || []);
  } else {
    await saveChannelMessages(chId);
  }
}

function buildComposer(chId, typingEl) {
  let composerWrap;
  let mentionDropdown = null;

  const textarea = h('textarea.composer-input', {
    placeholder: chId.startsWith('dm:') ? 'Message...' : `Message #${chId}`,
    rows: 1,
  });

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(200, textarea.scrollHeight) + 'px';
  }

  const sendBtn = h('button.composer-send', { onclick: send }, icon('send'));

  async function send() {
    const text = textarea.value.trim();
    if (!text) return;
    const msg = {
      id: uid(),
      user: state.user.name,
      color: state.user.color,
      text,
      ts: Date.now(),
      reactions: {},
      threadCount: 0,
    };
    const msgs = state.channelMessages.get(chId) || [];
    msgs.push(msg);
    state.channelMessages.set(chId, msgs);
    textarea.value = '';
    autosize();
    await saveMsgs(chId);
    // Don't logChange for every message — too noisy
  }

  const throttledTyping = throttle(() => broadcastTyping(chId), 1500);

  textarea.addEventListener('input', () => {
    autosize();
    if (textarea.value.length > 0) throttledTyping();
    // Mention autocomplete
    const cursorPos = textarea.selectionStart;
    const before = textarea.value.slice(0, cursorPos);
    const m = before.match(/@(\w*)$/);
    if (m) {
      showMentionDropdown(m[1]);
    } else if (mentionDropdown) {
      mentionDropdown.remove();
      mentionDropdown = null;
    }
  });

  function showMentionDropdown(query) {
    const matches = VALID_USERS.filter(u => u.toLowerCase().startsWith(query.toLowerCase()));
    if (mentionDropdown) mentionDropdown.remove();
    if (!matches.length) return;
    mentionDropdown = h('div.mention-dropdown');
    matches.forEach((u, i) => {
      mentionDropdown.appendChild(h('div.mention-item' + (i === 0 ? '.focused' : ''),
        { onclick: () => insertMention(u) },
        h('div.avatar.sm', { style: { background: USER_COLORS[u] } }, u.slice(0, 2).toUpperCase()),
        h('span', u),
      ));
    });
    composerWrap.appendChild(mentionDropdown);
  }

  function insertMention(u) {
    const cursorPos = textarea.selectionStart;
    const before = textarea.value.slice(0, cursorPos);
    const after = textarea.value.slice(cursorPos);
    const replaced = before.replace(/@(\w*)$/, `@${u} `);
    textarea.value = replaced + after;
    textarea.focus();
    textarea.setSelectionRange(replaced.length, replaced.length);
    if (mentionDropdown) { mentionDropdown.remove(); mentionDropdown = null; }
  }

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mentionDropdown) {
        const first = mentionDropdown.querySelector('.mention-item');
        if (first) { first.click(); return; }
      }
      send();
    }
    if (e.key === 'Escape' && mentionDropdown) {
      mentionDropdown.remove();
      mentionDropdown = null;
    }
  });

  composerWrap = h('div.composer-box', { style: { position: 'relative' } },
    textarea,
    sendBtn,
  );
  return composerWrap;
}

async function createChannelPrompt() {
  const name = prompt('Channel name (lowercase, no spaces):');
  if (!name) return;
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  if (!cleaned) return;
  if (state.channels.find(c => c.id === cleaned)) { toast('Channel exists', 'warn'); return; }
  state.channels.push({ id: cleaned, name: cleaned, topic: '', type: 'channel', createdAt: Date.now(), createdBy: state.user.name });
  state.channelMessages.set(cleaned, []);
  await saveChannels();
  await logChange('created a channel', '#' + cleaned);
  state.activeChannel = cleaned;
  window.tempoNav.go('channels');
}

// Thread side panel
function openThread(parentMsgId, chId) {
  // Find the parent
  const msgs = state.channelMessages.get(chId) || [];
  const parent = msgs.find(m => m.id === parentMsgId);
  if (!parent) return;
  parent.thread = parent.thread || [];

  const main = document.querySelector('.channel-main');
  if (!main) return;
  // Remove existing thread panel
  main.querySelector('.thread-panel')?.remove();

  const panel = h('div.thread-panel');
  const head = h('div.thread-head',
    h('div',
      h('div.title', 'Thread'),
      h('div.sub', `reply to ${parent.user}`),
    ),
    h('button.close', { onclick: () => panel.remove() }, icon('x')),
  );
  const messages = h('div.thread-messages');
  function renderThread() {
    messages.innerHTML = '';
    // Show parent at top
    messages.appendChild(renderMessageRow(parent, chId, false));
    messages.appendChild(h('div', { style: { borderBottom: '1px solid rgba(148,163,184,0.12)', margin: '8px 0' } }));
    for (const r of parent.thread) {
      messages.appendChild(renderMessageRow(r, chId, false));
    }
  }
  renderThread();

  const replyInput = h('textarea.composer-input', { placeholder: 'Reply...', rows: 1 });
  async function sendReply() {
    const text = replyInput.value.trim();
    if (!text) return;
    parent.thread.push({
      id: uid(), user: state.user.name, color: state.user.color, text, ts: Date.now(), reactions: {},
    });
    parent.threadCount = parent.thread.length;
    replyInput.value = '';
    await saveMsgs(chId);
    renderThread();
  }
  replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } });
  const composer = h('div.thread-composer',
    h('div.composer-box', replyInput, h('button.composer-send', { onclick: sendReply }, icon('send'))),
  );

  panel.append(head, messages, composer);
  main.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('open'));
}
