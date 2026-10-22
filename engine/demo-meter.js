// UI-only state for the explicitly controlled demo OCPP booking session.
// The API's successful start response is the authoritative proof that the
// simulator was started for this booking; a subsequent stale status poll must
// not temporarily make the demo ring disappear.
export function confirmDemoStart(p, result) {
  if (result?.status !== 'charging' || result.simulated !== true) return false;
  p.demoStartConfirmed = true;
  p.demoOcpp = true;
  p.simulated = true;
  p.chargeStatus = 'charging';
  p.liveEnergyKwh = Number.isFinite(p.liveEnergyKwh) ? p.liveEnergyKwh : 0;
  return true;
}

export function adoptOcppStatus(p, data) {
  // A charging-status poll started before the successful demo start may
  // return 'awaiting_charge' afterward. Preserve the already-confirmed start
  // until the next up-to-date poll, but never mask a completion or review.
  const confirmed = p.demoStartConfirmed === true && data.demoOcpp === true;
  p.chargeStatus = confirmed && data.status === 'awaiting_charge' ? 'charging' : data.status;
  p.demoOcpp = data.demoOcpp === true;
  // Retain a confirmed, owner-authorized simulator start while the activity
  // screen receives asynchronous status updates. Never infer simulation from
  // a generic OCPP charging status or the existence of a demo server alone.
  p.simulated = data.simulated === true || (
    confirmed && p.chargeStatus === 'charging'
  );
  p.liveEnergyKwh = Number.isFinite(data.liveEnergyKwh) && data.liveEnergyKwh >= 0
    ? data.liveEnergyKwh : 0;
  p.livePowerKw = Number.isFinite(data.livePowerKw) && data.livePowerKw >= 0
    ? data.livePowerKw : null;
}

export function showDemoOcppMeter(p) {
  return p?.chargeStatus === 'charging' && p.demoOcpp === true && p.simulated === true;
}
