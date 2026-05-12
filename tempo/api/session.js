import { getSessionFromReq } from './_lib/session.js';

export default function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.status(200).json({ user: session.user, exp: session.exp });
}
