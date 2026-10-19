// Monthly performance report for the JMB and charging partner, as CSV (opens in Excel).
const cell = (v) => {
  const s = typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function monthlyReportCsv({ condoName, month, rows }) {
  const all = [['metric', 'value'], ['Condo', condoName], ['Month', month], ...rows];
  return `${all.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}
