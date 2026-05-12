// Video calls — presence-based mesh over PeerJS + Supabase signaling.
import { h, icon, esc, fmtTime, USER_COLORS, toast } from '../utils.js';
import { state, logChange } from '../state.js';
import { getSupa } from '../api.js';

let peer = null, myPeerId = null;
let localStream = null, cameraStream = null, screenStream = null;
let roomId = null, roomChannel = null;
let peerConns = new Map();
let micOn = true, camOn = true, screenSharing = false, chatOpen = false;
let lobbyStream = null;

export function renderVideo(root) {
  const header = h('div.view-header',
    h('div.view-header-left',
      h('div.view-header-title',
        h('div.sub', '# 08 · surface · talk · dive back in'),
        h('h1', 'Video Call'),
      ),
    ),
  );
  const lobby = buildLobby();
  const roomEl = buildRoom();
  const shell = h('div.video-shell.view-body.no-pad', lobby, roomEl);
  root.append(header, shell);

  // If we're already in a call, keep showing the room
  if (roomId) {
    lobby.style.display = 'none';
    roomEl.classList.add('active');
  }

  root.addEventListener('DOMNodeRemoved', () => {
    // Don't tear down the call when leaving the view; let user keep call going
    // (call state lives on globals)
  }, { once: true });
}

function buildLobby() {
  const lobby = h('div.video-lobby', { id: 'videoLobby' });
  const codeInput = h('input.input.join-code-input', { maxLength: 6, placeholder: '000000', inputmode: 'numeric' });
  const preview = h('div.lobby-preview', h('video', { autoplay: true, playsInline: true, muted: true }));

  let previewBtn;
  previewBtn = h('button.btn.btn-ghost', { onclick: async () => {
    if (lobbyStream) {
      lobbyStream.getTracks().forEach(t => t.stop()); lobbyStream = null;
      preview.classList.remove('show');
      previewBtn.textContent = 'Preview camera';
      return;
    }
    try {
      lobbyStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      preview.querySelector('video').srcObject = lobbyStream;
      preview.classList.add('show');
      previewBtn.textContent = 'Stop preview';
    } catch (e) { toast('Camera access denied: ' + e.message, 'bad'); }
  } }, 'Preview camera');

  lobby.appendChild(h('div.video-lobby-inner',
    h('div',
      h('h3', 'Start or join a room'),
      h('p', 'share a 6-digit code · up to 6 people'),
    ),
    preview,
    h('div.lobby-cards',
      h('div.card.lobby-card',
        h('h4', 'Create Room'),
        h('p', 'Get a 6-digit code and share it'),
        h('button.btn.btn-primary', { style: { width: '100%', justifyContent: 'center' },
          onclick: () => enterRoom(String(Math.floor(Math.random() * 900000) + 100000))
        }, 'Create →'),
      ),
      h('div.card.lobby-card',
        h('h4', 'Join Room'),
        h('p', 'Enter a 6-digit code from someone'),
        codeInput,
        h('button.btn.btn-primary', { style: { width: '100%', justifyContent: 'center', marginTop: '8px' },
          onclick: () => {
            const code = codeInput.value.trim();
            if (!/^\d{6}$/.test(code)) { toast('Enter a 6-digit code', 'warn'); return; }
            enterRoom(code);
          }
        }, 'Join →'),
      ),
    ),
    previewBtn,
  ));
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = codeInput.value.trim();
      if (/^\d{6}$/.test(code)) enterRoom(code);
    }
  });
  return lobby;
}

function buildRoom() {
  const room = h('div.video-room', { id: 'videoRoom' });
  const codeEl = h('span.room-code-val', { id: 'activeRoomCode', title: 'click to copy', onclick: () => copyCode(codeEl) }, '------');
  const countEl = h('span', { id: 'roomCount' }, '1 person');
  const grid = h('div.video-main-grid.p1', { id: 'videoGrid' });
  const sidebar = h('div.video-sidebar.hidden', { id: 'videoSidebar' },
    h('div.vside-head', '# in-call chat'),
    h('div.vside-msgs', { id: 'vsideMessages' }),
    h('div.vside-input',
      h('input.input', { id: 'vsideInput', placeholder: 'message...' }),
      h('button.btn.btn-primary.btn-icon', { id: 'vsideSend' }, icon('send')),
    ),
  );

  room.append(
    h('div.room-header-bar',
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        h('span', { style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--dusk)', textTransform: 'uppercase', letterSpacing: '0.2em' } }, '# room'),
        codeEl,
      ),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        countEl,
      ),
    ),
    h('div.video-call-body', grid, sidebar),
    h('div.video-controls',
      h('button.ctl-btn', { id: 'vcMute', title: 'Mute', onclick: toggleMute }, icon('mic')),
      h('button.ctl-btn', { id: 'vcCam', title: 'Camera', onclick: toggleCam }, icon('video')),
      h('button.ctl-btn', { id: 'vcScreen', title: 'Screen share', onclick: toggleScreen }, icon('share')),
      h('button.ctl-btn', { id: 'vcChat', title: 'Chat', onclick: toggleChat }, icon('msg')),
      h('button.ctl-btn.danger.wide', { onclick: leaveRoom }, icon('logout'), 'Leave'),
    ),
  );
  // Wire vside chat
  setTimeout(() => {
    const send = document.getElementById('vsideSend');
    const inp = document.getElementById('vsideInput');
    if (send && inp) {
      send.addEventListener('click', sendVsideMsg);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendVsideMsg(); });
    }
  }, 0);
  return room;
}

function copyCode(el) {
  navigator.clipboard?.writeText(roomId).then(() => {
    const orig = el.textContent;
    el.textContent = 'copied!';
    el.classList.add('copied');
    setTimeout(() => { el.textContent = orig; el.classList.remove('copied'); }, 1200);
  });
}

function initPeer() {
  return new Promise((resolve) => {
    if (!window.Peer) { resolve(false); return; }
    if (peer && !peer.destroyed && myPeerId) { resolve(true); return; }
    if (peer) try { peer.destroy(); } catch {}
    peer = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    });
    peer.on('open', (id) => { myPeerId = id; resolve(true); });
    peer.on('error', (e) => { console.error('peer error', e); if (!myPeerId) resolve(false); });
    peer.on('call', (call) => {
      if (!localStream) { call.close(); return; }
      const meta = call.metadata || {};
      let user = meta.user || 'Peer', color = meta.color || '#94a3b8';
      if (roomChannel) {
        try { const ps = roomChannel.presenceState(); const arr = ps[call.peer]; if (arr && arr[0]) { user = arr[0].user; color = arr[0].color; } } catch {}
      }
      call.answer(localStream);
      peerConns.set(call.peer, { call, user, color });
      attachCallHandlers(call, user, color, call.peer);
    });
  });
}

async function enterRoom(code) {
  const supa = getSupa();
  if (!supa) { toast('Supabase unavailable', 'bad'); return; }
  try {
    if (lobbyStream) { localStream = lobbyStream; lobbyStream = null; document.querySelector('.lobby-preview')?.classList.remove('show'); }
    else { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
    cameraStream = localStream;
  } catch (e) { toast('Camera/mic required to join: ' + e.message, 'bad'); return; }

  const ok = await initPeer();
  if (!ok || !myPeerId) { toast('Peer connection failed', 'bad'); return; }

  roomId = code;
  document.getElementById('videoLobby').style.display = 'none';
  document.getElementById('videoRoom').classList.add('active');
  document.getElementById('activeRoomCode').textContent = roomId;

  addLocalTile();

  roomChannel = supa.channel(`tempo-video-${roomId}`, { config: { presence: { key: myPeerId }, broadcast: { self: false } } });
  roomChannel
    .on('presence', { event: 'sync' }, () => {
      const ps = roomChannel.presenceState();
      Object.entries(ps).forEach(([pid, arr]) => {
        if (pid === myPeerId) return;
        if (!arr || !arr.length) return;
        if (peerConns.has(pid)) return;
        const info = arr[0];
        // Lexicographic initiator prevents glare
        if (myPeerId < pid) callPeer(pid, info.user, info.color);
      });
      updateRoomCount();
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences.forEach(p => { if (p.peerId && p.peerId !== myPeerId) addVsideSys(`${p.user} joined`); });
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach(p => { if (p.peerId && p.peerId !== myPeerId) { removePeerTile(p.peerId); addVsideSys(`${p.user} left`); } });
    })
    .on('broadcast', { event: 'chat-msg' }, (m) => { addVsideMsg(m.payload); })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await roomChannel.track({ peerId: myPeerId, user: state.user.name, color: state.user.color });
        await logChange('joined a video room', `room #${roomId}`);
      }
    });
  updateVideoGrid();
}

function callPeer(pid, user, color) {
  if (!localStream || !peer) return;
  try {
    const call = peer.call(pid, localStream, { metadata: { user: state.user.name, color: state.user.color } });
    if (!call) return;
    peerConns.set(pid, { call, user, color });
    attachCallHandlers(call, user, color, pid);
  } catch (e) { console.error(e); }
}

function attachCallHandlers(call, user, color, pid) {
  call.on('stream', (rs) => {
    addRemoteTile(pid, user, color, rs);
    updateVideoGrid();
    updateRoomCount();
  });
  call.on('close', () => removePeerTile(pid));
  call.on('error', () => removePeerTile(pid));
}

function addLocalTile() {
  const grid = document.getElementById('videoGrid');
  let tile = grid.querySelector('.local-tile');
  if (tile) { tile.querySelector('video').srcObject = localStream; return; }
  tile = createTile('local', state.user.name, state.user.color, localStream, true);
  grid.appendChild(tile);
}
function addRemoteTile(pid, user, color, stream) {
  const grid = document.getElementById('videoGrid');
  let tile = grid.querySelector(`[data-peer="${pid}"]`);
  if (tile) { tile.querySelector('video').srcObject = stream; return; }
  tile = createTile(pid, user, color, stream, false);
  grid.appendChild(tile);
}
function createTile(pid, user, color, stream, isLocal) {
  const tile = h('div.vtile' + (isLocal ? '.local-tile' : ''), { 'data-peer': pid });
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; if (isLocal) v.muted = true; v.srcObject = stream;
  tile.append(v, h('div.vtile-name',
    h('span.vdot', { style: { background: color, boxShadow: `0 0 6px ${color}` } }),
    user + (isLocal ? ' (you)' : ''),
  ));
  return tile;
}
function removePeerTile(pid) {
  document.getElementById('videoGrid')?.querySelector(`[data-peer="${pid}"]`)?.remove();
  const c = peerConns.get(pid); if (c) try { c.call.close(); } catch {}
  peerConns.delete(pid);
  updateVideoGrid(); updateRoomCount();
}
function updateVideoGrid() {
  const grid = document.getElementById('videoGrid'); if (!grid) return;
  const n = grid.querySelectorAll('.vtile').length;
  grid.className = 'video-main-grid';
  if (n <= 1) grid.classList.add('p1');
  else if (n === 2) grid.classList.add('p2');
  else if (n === 3) grid.classList.add('p3');
  else if (n === 4) grid.classList.add('p4');
  else if (n <= 6) grid.classList.add('p6');
  else grid.classList.add('p8');
}
function updateRoomCount() {
  let total = 1;
  if (roomChannel) try { total = Object.keys(roomChannel.presenceState()).length || 1; } catch {}
  const el = document.getElementById('roomCount'); if (el) el.textContent = `${total} person${total !== 1 ? 's' : ''}`;
}

function toggleMute() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  document.getElementById('vcMute')?.classList.toggle('muted', !micOn);
}
function toggleCam() {
  if (!localStream || screenSharing) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  document.getElementById('vcCam')?.classList.toggle('muted', !camOn);
}
async function toggleScreen() {
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const track = screenStream.getVideoTracks()[0];
      peerConns.forEach(({ call }) => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(track);
      });
      const localTile = document.querySelector('.local-tile');
      if (localTile) {
        localTile.querySelector('video').srcObject = screenStream;
        localTile.classList.add('is-screen');
        if (!localTile.querySelector('.vtile-screen-badge'))
          localTile.appendChild(h('div.vtile-screen-badge', 'SHARING'));
      }
      track.onended = () => stopScreen();
      screenSharing = true;
      document.getElementById('vcScreen')?.classList.add('active-ctl');
      await logChange('shared screen', `room #${roomId}`);
    } catch (e) { console.log('cancelled', e); }
  } else { stopScreen(); }
}
async function stopScreen() {
  if (!screenSharing) return;
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  const camTrack = cameraStream?.getVideoTracks()[0];
  if (camTrack) peerConns.forEach(({ call }) => {
    const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(camTrack);
  });
  const localTile = document.querySelector('.local-tile');
  if (localTile && cameraStream) {
    localTile.querySelector('video').srcObject = cameraStream;
    localTile.classList.remove('is-screen');
    localTile.querySelector('.vtile-screen-badge')?.remove();
  }
  screenSharing = false;
  document.getElementById('vcScreen')?.classList.remove('active-ctl');
}
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('videoSidebar')?.classList.toggle('hidden', !chatOpen);
  document.getElementById('vcChat')?.classList.toggle('active-ctl', chatOpen);
}
async function sendVsideMsg() {
  const inp = document.getElementById('vsideInput'); if (!inp || !roomChannel) return;
  const text = inp.value.trim(); if (!text) return;
  const m = { user: state.user.name, color: state.user.color, text, ts: Date.now() };
  await roomChannel.send({ type: 'broadcast', event: 'chat-msg', payload: m });
  addVsideMsg(m); inp.value = '';
}
function addVsideMsg(m) {
  const c = document.getElementById('vsideMessages'); if (!c) return;
  c.appendChild(h('div.vmsg',
    h('div.vmsg-who', { style: { color: m.color } }, m.user),
    h('div.vmsg-text', m.text),
  ));
  c.scrollTop = c.scrollHeight;
}
function addVsideSys(msg) {
  const c = document.getElementById('vsideMessages'); if (!c) return;
  c.appendChild(h('div.vmsg-sys', '· ' + msg + ' ·'));
  c.scrollTop = c.scrollHeight;
}
async function leaveRoom() {
  if (roomChannel) { try { await roomChannel.untrack(); } catch {} try { getSupa().removeChannel(roomChannel); } catch {} roomChannel = null; }
  peerConns.forEach(({ call }) => { try { call.close(); } catch {} }); peerConns.clear();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (cameraStream && cameraStream !== localStream) { cameraStream.getTracks().forEach(t => t.stop()); } cameraStream = null;
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  const grid = document.getElementById('videoGrid'); if (grid) grid.innerHTML = '';
  document.getElementById('videoRoom')?.classList.remove('active');
  const lobby = document.getElementById('videoLobby'); if (lobby) lobby.style.display = 'flex';
  document.getElementById('videoSidebar')?.classList.add('hidden');
  const vm = document.getElementById('vsideMessages'); if (vm) vm.innerHTML = '';
  chatOpen = false; micOn = true; camOn = true; screenSharing = false;
  document.getElementById('vcMute')?.classList.remove('muted');
  document.getElementById('vcCam')?.classList.remove('muted');
  document.getElementById('vcScreen')?.classList.remove('active-ctl');
  document.getElementById('vcChat')?.classList.remove('active-ctl');
  roomId = null;
  if (peer && !peer.destroyed) try { peer.destroy(); peer = null; myPeerId = null; } catch {}
  await logChange('left a video room', '');
}

window.addEventListener('beforeunload', () => {
  if (roomChannel) { try { roomChannel.untrack(); } catch {} try { getSupa()?.removeChannel(roomChannel); } catch {} }
});
