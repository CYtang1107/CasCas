// JMB login: PIN per condo → signed token valid 12 h for that condo only.
import crypto from 'node:crypto';

const TOKEN_MS = 12 * 3600e3;
const WINDOW_MS = 10 * 60e3;
const MAX_TRIES = 10;

export function createAuth({ secret, pins, now = () => Date.now() }) {
  const tries = new Map();
  const sign = (condoId, exp) => crypto.createHmac('sha256', secret).update(`${condoId}.${exp}`).digest('hex');

  function login(condoId, pin, clientId = 'unknown') {
    const t = now();
    // Avoid letting one hostile client lock out every JMB user at a condo.
    const bucket = `${condoId}:${clientId}`;
    const recent = (tries.get(bucket) || []).filter((x) => t - x < WINDOW_MS);
    tries.set(bucket, recent);
    if (recent.length >= MAX_TRIES) return { status: 429 };
    if (!pins[condoId] || String(pin) !== String(pins[condoId])) { recent.push(t); return { status: 401 }; }
    tries.delete(bucket);
    const expiresAt = t + TOKEN_MS;
    return { status: 200, token: `${condoId}.${expiresAt}.${sign(condoId, expiresAt)}`, expiresAt };
  }

  function verify(header, condoId) {
    const m = /^Bearer (\S+)$/.exec(header || '');
    if (!m) return false;
    const [id, exp, sig] = m[1].split('.');
    if (id !== condoId || !(Number(exp) > now())) return false;
    const a = Buffer.from(sig || '', 'hex');
    const b = Buffer.from(sign(id, Number(exp)), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return { login, verify };
}
