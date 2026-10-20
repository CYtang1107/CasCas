// Turn Open Charge Map stations into CasSama chargers.
import { priceFor } from '../data/operator-prices.js';

const DC_MIN_KW = 25;

function plugOf(conn) {
  const t = String(conn?.ConnectionType?.Title || '').toLowerCase();
  if (t.includes('chademo')) return 'CHAdeMO';
  if (t.includes('ccs')) return 'CCS2';
  if (t.includes('type 2') || t.includes('mennekes')) return 'Type2';
  if (t.includes('tesla')) return (conn.PowerKW || 0) >= DC_MIN_KW ? 'CCS2' : 'Type2';
  return null;
}

export function normaliseOcm(poi) {
  const a = poi?.AddressInfo;
  if (!a || typeof a.Latitude !== 'number' || typeof a.Longitude !== 'number') return null;
  if (/private/i.test(poi.UsageType?.Title || '')) return null;

  const conns = Array.isArray(poi.Connections) ? poi.Connections : [];
  const plugs = conns.map(plugOf);
  const isDc = plugs.some((p) => p === 'CCS2' || p === 'CHAdeMO') || conns.some((c) => (c.PowerKW || 0) >= DC_MIN_KW);
  const type = isDc ? 'DC' : 'AC';
  const maxKw = Math.max(0, ...conns.map((c) => c.PowerKW || 0));
  const connectors = [...new Set(plugs.filter(Boolean))];
  const quantity = conns.reduce((s, c) => s + (c.Quantity || 0), 0);
  const title = poi.OperatorInfo?.Title;
  const operator = !title || /unknown operator/i.test(title) ? 'Unknown operator' : title; // OCM spells it two ways

  return {
    id: `ocm-${poi.ID}`,
    name: a.Title || 'Charging station',
    address: [a.AddressLine1, a.Town].filter(Boolean).join(', '),
    operator,
    lat: a.Latitude,
    lng: a.Longitude,
    type,
    kw: maxKw || (isDc ? 50 : 7),
    connectors: connectors.length ? connectors : [isDc ? 'CCS2' : 'Type2'],
    bays: poi.NumberOfPoints || quantity || 1,
    ...priceFor(operator, type),
    reliability: poi.StatusType?.IsOperational === false ? 0.5 : 0.9,
    siteType: 'public',
    source: 'ocm',
  };
}

export function normaliseAll(pois) {
  return (Array.isArray(pois) ? pois : []).map(normaliseOcm).filter(Boolean);
}
