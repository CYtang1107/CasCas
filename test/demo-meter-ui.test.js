import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDemoStart, adoptOcppStatus, showDemoOcppMeter } from '../engine/demo-meter.js';

test('resident OCPP demo: the confirmed start immediately displays the ring', () => {
  const p = { chargeStatus: 'awaiting_charge', demoOcpp: true, simulated: false };
  assert.equal(showDemoOcppMeter(p), false);
  assert.equal(confirmDemoStart(p, { status: 'charging', simulated: true }), true);
  assert.equal(showDemoOcppMeter(p), true);
  assert.equal(p.liveEnergyKwh, 0);
  adoptOcppStatus(p, { status: 'charging', demoOcpp: true, simulated: true, liveEnergyKwh: 0.6, livePowerKw: 6.9 });
  assert.equal(showDemoOcppMeter(p), true);
  assert.equal(p.liveEnergyKwh, 0.6);
});

test('a delayed status read cannot erase an owner-confirmed demo start', () => {
  const p = { chargeStatus: 'awaiting_charge', demoOcpp: true };
  confirmDemoStart(p, { status: 'charging', simulated: true });
  adoptOcppStatus(p, { status: 'charging', demoOcpp: true, simulated: false, liveEnergyKwh: 0.2 });
  assert.equal(showDemoOcppMeter(p), true);
  assert.equal(p.liveEnergyKwh, 0.2);
});

test('late awaiting-charge status cannot make a confirmed demo ring disappear', () => {
  const p = {};
  confirmDemoStart(p, { status: 'charging', simulated: true });
  adoptOcppStatus(p, { status: 'awaiting_charge', demoOcpp: true, simulated: false });
  assert.equal(p.chargeStatus, 'charging');
  assert.equal(showDemoOcppMeter(p), true);
});

test('a real OCPP session is never classified as a demo just because demo controls exist', () => {
  const p = {};
  adoptOcppStatus(p, { status: 'charging', demoOcpp: true, simulated: false, liveEnergyKwh: 2.5 });
  assert.equal(showDemoOcppMeter(p), false);
  assert.equal(confirmDemoStart(p, { status: 'charging', simulated: false }), false);
  assert.equal(showDemoOcppMeter(p), false);
});

test('the demo ring stops on completion or when demo mode is disabled', () => {
  const p = {};
  confirmDemoStart(p, { status: 'charging', simulated: true });
  adoptOcppStatus(p, { status: 'completed', demoOcpp: true, simulated: true, liveEnergyKwh: 5 });
  assert.equal(showDemoOcppMeter(p), false);
  adoptOcppStatus(p, { status: 'charging', demoOcpp: false, simulated: false });
  assert.equal(showDemoOcppMeter(p), false);
});

test('invalid or negative live meter values are ignored rather than displayed', () => {
  const p = {};
  confirmDemoStart(p, { status: 'charging', simulated: true });
  adoptOcppStatus(p, { status: 'charging', demoOcpp: true, simulated: true, liveEnergyKwh: -1, livePowerKw: NaN });
  assert.equal(p.liveEnergyKwh, 0);
  assert.equal(p.livePowerKw, null);
});
