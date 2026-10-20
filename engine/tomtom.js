// TomTom data, made to fit CasSama (pure): EV stations with live bay availability, routes that
// include live traffic, and traffic incidents. The server fetches these with the key.
import { distanceKm } from './geo.js';
import { priceFor } from '../data/operator-prices.js';

const PLUG = { IEC62196Type2Outlet: 'Type2', IEC62196Type2CableAttached: 'Type2', IEC62196Type2CCS: 'CCS2', Chademo: 'CHAdeMO', IEC62196Type1: 'Type1', IEC62196Type1CCS: 'CCS1', Tesla: 'CCS2' };

export function stationsFromSearch(json) {
  const out = [];
  for (const r of json?.results || []) {
    const conns = r.chargingPark?.connectors || [];
    if (!conns.length || !r.position) continue;
    const dc = conns.some((c) => String(c.currentType).startsWith('DC'));
    const kw = Math.max(...conns.map((c) => Number(c.ratedPowerKW) || 0));
    const type = dc ? 'DC' : 'AC';
    const operator = r.poi?.brands?.[0]?.name || 'Unknown operator';
    out.push({
      id: `tt-${r.id}`, name: r.poi?.name || 'EV charging', operator, lat: r.position.lat, lng: r.position.lon,
      type, kw: kw || (dc ? 50 : 7), connectors: [...new Set(conns.map((c) => PLUG[c.connectorType]).filter(Boolean))],
      bays: conns.length, siteType: 'public', reliability: 0.9, ...priceFor(operator, type),
      availabilityId: r.dataSources?.chargingAvailability?.id || null, source: 'tomtom',
    });
  }
  return out;
}

export function parseAvailability(json) {
  if (!json?.connectors) return null;
  const sum = { total: 0, available: 0, occupied: 0, outOfService: 0, unknown: 0 };
  for (const c of json.connectors) {
    const cur = c.availability?.current || {};
    sum.total += c.total || 0;
    sum.available += cur.available || 0;
    sum.occupied += (cur.occupied || 0) + (cur.reserved || 0);
    sum.outOfService += cur.outOfService || 0;
    sum.unknown += cur.unknown || 0;
  }
  return sum;
}

// Live availability onto our chargers (same place within 150 m and the same AC/DC), and live
// TomTom stations we did not have yet as extra chargers. Stations without live data add nothing.
export function attachLive(chargers, stations, maxKm = 0.15) {
  const out = chargers.map((c) => ({ ...c }));
  for (const s of stations) {
    if (!s.live) continue;
    const match = out.find((c) => c.type === s.type && distanceKm(c, s) <= maxKm);
    if (match) match.liveAvail = s.live;
    else out.push({ ...s, liveAvail: s.live });
  }
  return out;
}

export function parseTtRoute(json) {
  return (json?.routes || []).map((r) => {
    const coords = (r.legs || []).flatMap((l) => (l.points || []).map((p) => [p.latitude, p.longitude]));
    let offset = 0;
    const legs = (r.legs || []).map((l) => {
      const start = offset;
      offset += l.summary?.lengthInMeters || 0;
      const steps = (r.guidance?.instructions || [])
        .filter((i) => i.routeOffsetInMeters >= start && i.routeOffsetInMeters <= offset)
        .map((i) => ({ text: i.message, km: Math.round((i.routeOffsetInMeters - start) / 10) / 100 }));
      return { km: Math.round((l.summary?.lengthInMeters || 0) / 100) / 10, minutes: Math.round((l.summary?.travelTimeInSeconds || 0) / 60), steps };
    });
    return {
      km: Math.round(r.summary.lengthInMeters / 100) / 10,
      minutes: Math.round(r.summary.travelTimeInSeconds / 60),
      delayMin: Math.round((r.summary.trafficDelayInSeconds || 0) / 60),
      coords, legs, live: true,
      traffic: (r.sections || []).filter((x) => x.sectionType === 'TRAFFIC').map((x) => ({ from: x.startPointIndex, to: x.endPointIndex, level: x.magnitudeOfDelay ?? 1 })),
    };
  });
}

export const INCIDENT_KINDS = { 1: 'accident', 6: 'jam', 7: 'lane', 8: 'closed', 9: 'roadworks', 11: 'flood', 14: 'breakdown' };

export function parseIncidents(json) {
  return (json?.incidents || []).map((f) => {
    const p = f.properties || {};
    const g = f.geometry || {};
    const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates || [];
    const [lng, lat] = pts[0] || [];
    return {
      id: p.id, kind: INCIDENT_KINDS[p.iconCategory] || 'other', label: p.events?.[0]?.description || 'Incident',
      lat, lng, coords: pts.map(([x, y]) => [y, x]), magnitude: p.magnitudeOfDelay || 0,
      where: [p.from, p.to].filter(Boolean).join(' → '), delayMin: Math.round((p.delay || 0) / 60),
    };
  }).filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng));
}

// Incidents within `meters` of any point of a route (route points every few hundred metres at most).
export function incidentsNear(incidents, coords, meters = 300) {
  const step = Math.max(1, Math.floor(coords.length / 400));
  const pts = coords.filter((_, i) => i % step === 0).map(([lat, lng]) => ({ lat, lng }));
  return incidents.filter((i) => pts.some((p) => distanceKm(p, i) * 1000 <= meters));
}
