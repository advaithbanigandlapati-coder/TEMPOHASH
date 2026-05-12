// Global app state + realtime sync. Single source of truth.
import { loadKey, saveKey, getSupa } from './api.js';
import { uid, debounce, toast } from './utils.js';

export const KEYS = {
  // Channels: keys like tempo:ch:general, tempo:ch:random etc.
  channelsIndex: 'tempo:channels:index',     // [{id, name, topic, type, members?}]
  // tempo:ch:<id> stores messages array

  // DMs: tempo:dm:<user1>_<user2> (sorted alphabetically)
  dmIndex:       'tempo:dm:index',           // [{id, members: [u1, u2]}]

  // Calendar
  calendar:      'tempo:calendar',

  // Tasks (kanban)
  tasks:         'tempo:tasks',

  // Notes (hierarchical pages)
  notes:         'tempo:notes',

  // Plans
  plans:         'tempo:plans',

  // Polls
  polls:         'tempo:polls',

  // Ideas
  ideas:         'tempo:ideas',

  // Canvas
  canvasStrokes: 'tempo:canvas:strokes',
  canvasNotes:   'tempo:canvas:notes',

  // Focus sessions
  focusSessions: 'tempo:focus:sessions',

  // Changelog
  changelog:     'tempo:changelog',
};

export const state = {
  user: null,                  // {name, color}
  channels: [],                // [{id, name, topic, type, lastReadAt: {[user]: ts}, unread: 0}]
  channelMessages: new Map(),  // channelId -> [msg]
  activeChannel: null,
  dms: [],
  events: [],
  tasks: [],
  notes: [],
  notesTree: [],               // computed tree
  activeNoteId: null,
  plans: [],
  polls: [],
  ideas: [],
  canvasStrokes: [],
  canvasNotes: [],
  focusSessions: [],
  changelog: [],
  presence: new Map(),         // user -> {status, ts, focusUntil?}
  unread: new Map(),           // channelId -> count
};

// Per-key subscribers. Views register callbacks for keys they care about.
const subs = new Map();
export function subscribe(key, cb) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key).add(cb);
  return () => subs.get(key)?.delete(cb);
}
function notify(key) {
  subs.get(key)?.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
}
function notifyAll() {
  for (const s of subs.values()) s.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
}

// Realtime channel handles
let dataChannel = null;
let presenceChannel = null;
export let canvasChannel = null;

export async function initState(user) {
  state.user = user;

  // Load everything in parallel
  const [channels, calendar, tasks, notes, plans, polls, ideas, strokes, sticky, focusSessions, changelog] = await Promise.all([
    loadKey(KEYS.channelsIndex, getDefaultChannels()),
    loadKey(KEYS.calendar, []),
    loadKey(KEYS.tasks, []),
    loadKey(KEYS.notes, []),
    loadKey(KEYS.plans, []),
    loadKey(KEYS.polls, []),
    loadKey(KEYS.ideas, []),
    loadKey(KEYS.canvasStrokes, []),
    loadKey(KEYS.canvasNotes, []),
    loadKey(KEYS.focusSessions, []),
    loadKey(KEYS.changelog, []),
  ]);
  state.channels = channels;
  state.events = calendar;
  state.tasks = tasks;
  state.notes = notes;
  state.plans = plans;
  state.polls = polls;
  state.ideas = ideas;
  state.canvasStrokes = strokes;
  state.canvasNotes = sticky;
  state.focusSessions = focusSessions;
  state.changelog = changelog;

  // Load messages for each channel
  await Promise.all(state.channels.map(async ch => {
    const msgs = await loadKey('tempo:ch:' + ch.id, []);
    state.channelMessages.set(ch.id, msgs);
    computeUnread(ch.id);
  }));

  // Ensure default channels exist if first run
  if (!channels || channels.length === 0) {
    state.channels = getDefaultChannels();
    await saveKey(KEYS.channelsIndex, state.channels);
  }

  setupRealtime();
  startPresenceHeartbeat();
}

function getDefaultChannels() {
  return [
    { id: 'general', name: 'general', topic: 'team-wide chatter', type: 'channel', createdAt: Date.now() },
    { id: 'random', name: 'random', topic: 'off-topic, links, memes', type: 'channel', createdAt: Date.now() },
    { id: 'announcements', name: 'announcements', topic: 'important updates', type: 'channel', createdAt: Date.now() },
  ];
}

function setupRealtime() {
  const supa = getSupa();
  if (!supa) return;

  // Data channel: every postgres change to tempo_data
  dataChannel = supa.channel('tempo_data_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tempo_data' }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      const { key, value } = row;
      handleRemoteChange(key, value);
    })
    .subscribe();

  // Presence channel: who's online/focusing/away
  presenceChannel = supa.channel('tempo_presence', {
    config: { presence: { key: state.user.name } }
  });
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      state.presence.clear();
      const ps = presenceChannel.presenceState();
      for (const [user, arr] of Object.entries(ps)) {
        if (arr && arr[0]) state.presence.set(user, arr[0]);
      }
      notify('presence');
    })
    .on('presence', { event: 'join' }, () => notify('presence'))
    .on('presence', { event: 'leave' }, () => notify('presence'))
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      // Broadcast typing — forwarded to channel views
      subs.get('typing')?.forEach(cb => cb(payload));
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ status: 'online', user: state.user.name, ts: Date.now() });
      }
    });

  // Canvas collab channel (separate, for high-frequency cursor/stroke events)
  canvasChannel = supa.channel('tempo_canvas_collab', { config: { broadcast: { self: false } } })
    .subscribe();
}

function handleRemoteChange(key, value) {
  if (!key) return;

  if (key === KEYS.channelsIndex) {
    state.channels = value || [];
    notify('channels');
  } else if (key.startsWith('tempo:ch:')) {
    const chId = key.slice('tempo:ch:'.length);
    state.channelMessages.set(chId, value || []);
    computeUnread(chId);
    notify('messages:' + chId);
    notify('channels');
  } else if (key.startsWith('tempo:dm:') && key !== KEYS.dmIndex) {
    const dmId = key.slice('tempo:dm:'.length);
    const chId = 'dm:' + dmId;
    state.channelMessages.set(chId, value || []);
    computeUnread(chId);
    notify('messages:' + chId);
    notify('channels');
  } else if (key === KEYS.calendar) { state.events = value || []; notify('calendar'); }
  else if (key === KEYS.tasks)      { state.tasks = value || []; notify('tasks'); }
  else if (key === KEYS.notes)      { state.notes = value || []; notify('notes'); }
  else if (key === KEYS.plans)      { state.plans = value || []; notify('plans'); }
  else if (key === KEYS.polls)      { state.polls = value || []; notify('polls'); }
  else if (key === KEYS.ideas)      { state.ideas = value || []; notify('ideas'); }
  else if (key === KEYS.canvasStrokes) { state.canvasStrokes = value || []; notify('canvas'); }
  else if (key === KEYS.canvasNotes)   { state.canvasNotes = value || []; notify('canvasNotes'); }
  else if (key === KEYS.focusSessions) { state.focusSessions = value || []; notify('focus'); }
  else if (key === KEYS.changelog)     { state.changelog = value || []; notify('changelog'); }
}

function computeUnread(chId) {
  const msgs = state.channelMessages.get(chId) || [];
  const lastReadStr = localStorage.getItem('tempo:lastRead:' + chId) || '0';
  const lastRead = parseInt(lastReadStr, 10) || 0;
  const unread = msgs.filter(m => m.ts > lastRead && m.user !== state.user.name).length;
  state.unread.set(chId, unread);
}

export function markRead(chId) {
  localStorage.setItem('tempo:lastRead:' + chId, String(Date.now()));
  state.unread.set(chId, 0);
  notify('channels');
}

// Save helpers per type
export async function saveChannels() { await saveKey(KEYS.channelsIndex, state.channels); }
export async function saveChannelMessages(chId) { await saveKey('tempo:ch:' + chId, state.channelMessages.get(chId) || []); }
export async function saveCalendar()  { await saveKey(KEYS.calendar, state.events); }
export async function saveTasks()     { await saveKey(KEYS.tasks, state.tasks); }
export async function saveNotes()     { await saveKey(KEYS.notes, state.notes); }
export async function savePlans()     { await saveKey(KEYS.plans, state.plans); }
export async function savePolls()     { await saveKey(KEYS.polls, state.polls); }
export async function saveIdeas()     { await saveKey(KEYS.ideas, state.ideas); }
export async function saveCanvasStrokes() { await saveKey(KEYS.canvasStrokes, state.canvasStrokes); }
export async function saveCanvasNotes()   { await saveKey(KEYS.canvasNotes, state.canvasNotes); }
export async function saveFocusSessions() { await saveKey(KEYS.focusSessions, state.focusSessions); }

// Changelog
export async function logChange(action, detail = '') {
  if (!state.user) return;
  const entry = {
    id: uid(),
    user: state.user.name,
    color: state.user.color,
    action,
    detail,
    ts: Date.now(),
  };
  state.changelog.unshift(entry);
  if (state.changelog.length > 500) state.changelog = state.changelog.slice(0, 500);
  await saveKey(KEYS.changelog, state.changelog);
  notify('changelog');
}

// Presence heartbeat
let _focusUntil = 0;
export function setFocusMode(durationMs) {
  _focusUntil = Date.now() + durationMs;
  trackPresence();
}
export function clearFocusMode() { _focusUntil = 0; trackPresence(); }

async function trackPresence() {
  if (!presenceChannel) return;
  const focusing = _focusUntil > Date.now();
  await presenceChannel.track({
    status: focusing ? 'focusing' : 'online',
    user: state.user.name,
    ts: Date.now(),
    focusUntil: focusing ? _focusUntil : null,
  });
}

function startPresenceHeartbeat() {
  setInterval(() => trackPresence(), 30_000);
  document.addEventListener('visibilitychange', () => trackPresence());
}

export function broadcastTyping(channelId) {
  if (!presenceChannel) return;
  presenceChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user: state.user.name, channelId, ts: Date.now() },
  });
}
