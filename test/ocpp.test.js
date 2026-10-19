import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame, call, callResult, callError, parsePointId, siteLimitKw, shareLoad, chargingProfile, meterReading, liveSummary } from '../engine/ocpp.js';

const condos = [{ id: 'lumina', bays: 10 }, { id: 'azalea', bays: 6, loadLimitKw: 20 }];

test('OCPP-J frames: CALL, CALLRESULT and CALLERROR', () => {
  assert.deepEqual(parseFrame('[2,"a1","BootNotification",{"chargePointVendor":"Sim"}]'),
    { type: 'call', id: 'a1', action: 'BootNotification', payload: { chargePointVendor: 'Sim' } });
  assert.deepEqual(parseFrame('[3,"a1",{"status":"Accepted"}]'), { type: 'result', id: 'a1', payload: { status: 'Accepted' } });
  assert.deepEqual(parseFrame('[4,"a1","NotImplemented","nope",{}]'), { type: 'error', id: 'a1', code: 'NotImplemented', description: 'nope' });
  assert.equal(parseFrame('not json'), null);
  assert.equal(parseFrame('[9,"x"]'), null);
  assert.equal(parseFrame('[2,"x","Heartbeat"]'), null);
  assert.equal(call('u1', 'Heartbeat', {}), '[2,"u1","Heartbeat",{}]');
  assert.equal(callResult('u1', { currentTime: 'T' }), '[3,"u1",{"currentTime":"T"}]');
  assert.equal(callError('u1', 'FormationViolation', 'bad'), '[4,"u1","FormationViolation","bad",{}]');
});

test('charge point ids name a condo and a bay', () => {
  assert.deepEqual(parsePointId('lumina-3', condos), { condoId: 'lumina', bay: 3 });
  assert.equal(parsePointId('lumina-11', condos), null);
  assert.equal(parsePointId('lumina-0', condos), null);
  assert.equal(parsePointId('nowhere-1', condos), null);
  assert.equal(parsePointId('../x', condos), null);
});

test('site limit: assessed capacity, 60% of nameplate unless the condo sets one', () => {
  assert.equal(siteLimitKw(condos[0]), 42);
  assert.equal(siteLimitKw(condos[1]), 20);
});

test('load sharing caps each charging bay so the site stays inside its limit', () => {
  assert.equal(shareLoad(42, 4, 7), 7);
  assert.equal(shareLoad(42, 8, 7), 5.25);
  assert.equal(shareLoad(42, 0, 7), 7);
});

test('SetChargingProfile payload is a TxDefault limit in watts', () => {
  const p = chargingProfile(5.25);
  assert.equal(p.connectorId, 1);
  assert.equal(p.csChargingProfiles.chargingProfilePurpose, 'TxDefaultProfile');
  assert.equal(p.csChargingProfiles.chargingSchedule.chargingRateUnit, 'W');
  assert.deepEqual(p.csChargingProfiles.chargingSchedule.chargingSchedulePeriod, [{ startPeriod: 0, limit: 5250 }]);
});

test('meter values give energy and power', () => {
  const r = meterReading({ connectorId: 1, meterValue: [{ timestamp: 'T', sampledValue: [
    { value: '1500', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
    { value: '6.5', measurand: 'Power.Active.Import', unit: 'kW' },
  ] }] });
  assert.deepEqual(r, { energyWh: 1500, powerW: 6500 });
  assert.deepEqual(meterReading({ meterValue: [{ sampledValue: [{ value: '20' }] }] }), { energyWh: 20, powerW: null });
});

test('live summary counts bays by status; unknown bays are offline', () => {
  const points = [{ bay: 1, status: 'Charging' }, { bay: 2, status: 'Available' }, { bay: 3, status: 'Faulted' }, { bay: 4, status: 'Preparing' }];
  assert.deepEqual(liveSummary(points, 6), { charging: 1, available: 1, faulted: 1, other: 1, offline: 2, total: 6 });
});
