// Residents decide: a change to bay sharing is a proposal they vote on, and it only takes effect
// when it passes. Rule for the prototype: a simple majority of votes cast, with at least 10% of
// units voting. A real pilot would follow the condo's by-laws and the Strata Management Act.
import { round2 } from './pricing.js';

export const QUORUM = 0.1;
export const VOTE_DAYS = 7;

export function createProposal({ id, condoId, settings, now, days = VOTE_DAYS }) {
  return { id, condoId, settings, createdAt: now, closesAt: now + days * 864e5, votes: {}, status: 'open' };
}

export function castVote(p, voterId, vote, now) {
  if (vote !== 'yes' && vote !== 'no') return { error: 'Vote yes or no.' };
  if (p.status !== 'open' || now > p.closesAt) return { error: 'This vote has closed.' };
  if (!voterId) return { error: 'Missing voter.' };
  return { proposal: { ...p, votes: { ...p.votes, [voterId]: vote } } };
}

export function tally(p, units) {
  const all = Object.values(p.votes);
  const yes = all.filter((v) => v === 'yes').length;
  const no = all.length - yes;
  const quorum = Math.max(1, Math.ceil(units * QUORUM));
  const quorumMet = all.length >= quorum;
  return { yes, no, cast: all.length, quorum, quorumMet, passing: quorumMet && yes > no };
}

export function closeProposal(p, units, now) {
  const result = tally(p, units);
  return { ...p, status: result.passing ? 'passed' : 'failed', closedAt: now, result };
}

// What a resident sees: this month's charging income for the condo and what it is worth to them.
export function residentStatement(sim, condo) {
  const share = sim.revenue > 0 ? sim.visitorRevenue / sim.revenue : 0;
  return {
    jmbIncome: round2(sim.jmbIncome),
    fromVisitors: round2(sim.jmbIncome * share),
    perUnit: round2(sim.perUnitSaving),
    feeWithout: round2(condo.monthlyFee + sim.perUnitSaving),
    yearPerUnit: round2(sim.perUnitSaving * 12),
    costs: sim.recovery,
  };
}
