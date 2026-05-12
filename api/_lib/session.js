// HMAC-signed session cookies. Stateless — token contains user + expiry.
import crypto from 'crypto';

const COOKIE_NAME = 'tempo_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const VALID_USERS = ['Aakshat', 'Advaith', 'Abhi', 'Nivas'];

function getSecret() {
  const s = process.env.TEMPO_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('TEMPO_SESSION_SECRET env var missing or too short (need 16+ chars)');
  }
  return s;
}

function b64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

export function signSession(user) {
  if (!VALID_USERS.includes(user)) throw new Error('Invalid user');
  const payload = { user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  const actualSig = b64urlDecode(sigB64);
  if (expectedSig.length !== actualSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, actualSig)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString());
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!VALID_USERS.includes(payload.user)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
  return verifySession(cookies[COOKIE_NAME]);
}

export function setSessionCookie(res, token) {
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SEC}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
}

export function clearSessionCookie(res) {
  const cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  res.setHeader('Set-Cookie', cookie);
}

export function requireAuth(handler) {
  return async (req, res) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.session = session;
    return handler(req, res);
  };
}

export { VALID_USERS, COOKIE_NAME };
