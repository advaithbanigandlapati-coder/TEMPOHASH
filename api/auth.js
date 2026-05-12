import crypto from 'crypto';
import { signSession, setSessionCookie, VALID_USERS } from './_lib/session.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const expected = process.env.TEMPO_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'TEMPO_PASSWORD not configured' });
  }
  if (!process.env.TEMPO_SESSION_SECRET) {
    return res.status(500).json({ error: 'TEMPO_SESSION_SECRET not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { password, user } = body;
  if (typeof password !== 'string' || typeof user !== 'string') {
    return res.status(400).json({ error: 'password and user required' });
  }
  if (!VALID_USERS.includes(user)) {
    return res.status(400).json({ error: 'invalid user' });
  }

  // Constant-time password compare
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'wrong password' });
  }

  const token = signSession(user);
  setSessionCookie(res, token);
  return res.status(200).json({ ok: true, user });
}
