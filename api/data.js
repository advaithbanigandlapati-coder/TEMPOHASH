// Authenticated data API. Uses Supabase service-role key (server-only).
// GET  /api/data?key=...           → load one value
// POST /api/data  {key, value}     → upsert one value
// DELETE /api/data?key=...         → delete one value
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './_lib/session.js';

function getServerClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase server env vars missing');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Whitelist of allowed keys. Anything outside this gets rejected to prevent
// arbitrary key creation.
const KEY_PATTERN = /^tempo:[a-z0-9:_-]+$/i;

export default requireAuth(async function handler(req, res) {
  let supa;
  try { supa = getServerClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  if (req.method === 'GET') {
    const key = req.query?.key;
    if (!key || !KEY_PATTERN.test(key)) {
      return res.status(400).json({ error: 'invalid key' });
    }
    const { data, error } = await supa.from('tempo_data').select('value').eq('key', key).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ key, value: data?.value ?? null });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { key, value } = body;
    if (!key || !KEY_PATTERN.test(key)) {
      return res.status(400).json({ error: 'invalid key' });
    }
    if (value === undefined) {
      return res.status(400).json({ error: 'value required' });
    }
    // Size sanity check (~500KB)
    const serialized = JSON.stringify(value);
    if (serialized.length > 500_000) {
      return res.status(413).json({ error: 'value too large' });
    }
    const { error } = await supa.from('tempo_data').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: req.session.user,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const key = req.query?.key;
    if (!key || !KEY_PATTERN.test(key)) {
      return res.status(400).json({ error: 'invalid key' });
    }
    const { error } = await supa.from('tempo_data').delete().eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
});
