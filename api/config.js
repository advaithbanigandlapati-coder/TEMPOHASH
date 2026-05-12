import { requireAuth } from './_lib/session.js';

export default requireAuth(function handler(req, res) {
  // Returns the Supabase URL + anon key so the browser can do realtime subscriptions
  // and reads. Anon key cannot write — RLS blocks it. Writes go through /api/data.
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }
  return res.status(200).json({
    supabaseUrl: url,
    supabaseAnonKey: anon,
    user: req.session.user,
  });
});
