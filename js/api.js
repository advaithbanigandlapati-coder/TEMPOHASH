// API client. All server calls funnel through here.
// Reads = via Supabase realtime client (anon key, RLS-blocked from writes).
// Writes = via /api/data (cookie-authenticated, server uses service-role key).

import { toast } from './utils.js';

let _supa = null;
let _config = null;

export async function getSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function login(user, password) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ user, password }),
  });
  if (res.status === 401) return { ok: false, error: 'wrong password' };
  if (res.status === 400) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.error || 'invalid request' };
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.error || ('error ' + res.status) };
  }
  return { ok: true };
}

export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
}

export async function getConfig() {
  if (_config) return _config;
  const res = await fetch('/api/config', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load config: ' + res.status);
  _config = await res.json();
  return _config;
}

export function getSupa() {
  return _supa;
}

export async function initSupa() {
  if (_supa) return _supa;
  const cfg = await getConfig();
  if (!window.supabase) throw new Error('Supabase SDK not loaded');
  _supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return _supa;
}

// Load a value from Supabase directly (anon read, RLS allows it).
export async function loadKey(key, fallback = null) {
  if (!_supa) return fallback;
  try {
    const { data, error } = await _supa.from('tempo_data').select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    return data.value;
  } catch { return fallback; }
}

// Save value via /api/data (auth-required server route).
export async function saveKey(key, value) {
  try {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key, value }),
    });
    if (res.status === 401) {
      toast('Session expired — please reload', 'bad');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast('Save failed: ' + (d.error || res.status), 'bad');
      throw new Error(d.error || 'save failed');
    }
    return true;
  } catch (e) {
    console.error('saveKey', key, e);
    return false;
  }
}

export async function deleteKey(key) {
  try {
    const res = await fetch('/api/data?key=' + encodeURIComponent(key), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    return res.ok;
  } catch { return false; }
}
