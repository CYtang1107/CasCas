// Browser client for the CasSama shared server. URLs are relative, so on GitHub Pages
// (no server) the health check gets a 404 and the app stays in local mode.
const TIMEOUT_MS = 5000;

async function call(fetchFn, method, url, body, token, timeoutMs = TIMEOUT_MS) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl?.signal });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data };
    return {
      ok: false,
      status: res.status,
      error: data?.error || `Request failed (${res.status})`,
      ...(Array.isArray(data?.alternatives)
        ? { alternatives: data.alternatives }
        : {})
    };
  } catch {
    return { ok: false, status: 0, error: 'Server unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createApi({ base = '', fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const u = (p) => `${base}api/${p}`;
  const id = encodeURIComponent;
  return {
    health: () => call(fetchFn, 'GET', u('health')),
    chargers: () => call(fetchFn, 'GET', u('chargers')),
    world: (at) => call(fetchFn, 'GET', u(`world?at=${Number(at)}`)),
    book: (body) => call(fetchFn, 'POST', u('bookings'), body),
    bookingCheckIn: (bookingId, cancelToken, bay) => call(fetchFn, 'POST', u(`bookings/${id(bookingId)}/check-in`), { cancelToken, bay }),
    bookingChargingStatus: (bookingId, cancelToken) => call(fetchFn, 'POST', u(`bookings/${id(bookingId)}/charging-status`), { cancelToken }),
    bookingDemoOcpp: (bookingId, cancelToken, idTag, action) => call(fetchFn, 'POST',
      u(`bookings/${id(bookingId)}/demo-ocpp`), { cancelToken, idTag, action }, undefined, 12000),
    cancel: (bookingId, cancelToken) => call(fetchFn, 'DELETE', u(`bookings/${id(bookingId)}`), { cancelToken }),
    checkin: (body) => call(fetchFn, 'POST', u('checkins'), body),
    summary: (condoId) => call(fetchFn, 'GET', u(`condos/${id(condoId)}/summary`)),
    login: (condoId, pin) => call(fetchFn, 'POST', u('jmb/login'), { condoId, pin }),
    jmb: (condoId, token) => call(fetchFn, 'GET', u(`jmb/${id(condoId)}`), undefined, token),
    jmbChargingRevenue: (condoId, token, month) => call(fetchFn, 'GET',
      u(`jmb/${id(condoId)}/charging-revenue?month=${id(month)}`), undefined, token),
    issueResidentKey: (condoId, token, unitId) =>
    call(
      fetchFn,
      'POST',
      u(`jmb/${id(condoId)}/resident-keys`),
      unitId ? { unitId } : {},
      token
    ),
    saveSharing: (condoId, token, sharing) => call(fetchFn, 'PUT', u(`jmb/${id(condoId)}/sharing`), { sharing }, token),
    ocpp: (condoId) => call(fetchFn, 'GET', u(`ocpp/${id(condoId)}`)),
    ocppAction: (condoId, token, bay, action) => call(fetchFn, 'POST', u(`jmb/${id(condoId)}/ocpp/${Number(bay)}`), { action }, token),
    proposal: (condoId) => call(fetchFn, 'GET', u(`condos/${id(condoId)}/proposal`)),
    vote: (condoId, residentKey, vote) => call(fetchFn, 'POST', u(`condos/${id(condoId)}/proposal/vote`), { residentKey, vote }),
    propose: (condoId, token, settings) => call(fetchFn, 'POST', u(`jmb/${id(condoId)}/proposal`), { settings }, token),
    closeVote: (condoId, token) => call(fetchFn, 'POST', u(`jmb/${id(condoId)}/proposal/close`), {}, token),
    sampleVotes: (condoId, token) => call(fetchFn, 'POST', u(`jmb/${id(condoId)}/proposal/sample`), {}, token),
    addMaintenance: (condoId, token, entry) => call(fetchFn, 'POST', u(`jmb/${id(condoId)}/maintenance`), { entry }, token),
  };
}

export async function detectServer(api) {
  const r = await api.health();
  return r.ok && r.data?.ok === true;
}
