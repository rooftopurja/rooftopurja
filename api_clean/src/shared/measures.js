function round(n, d=2){ return Number.parseFloat(n).toFixed(d)*1; }

// Given an array of samples with fields: kW (instant), intervalMin (minutes), exportDelta_kWh, importDelta_kWh
function summarizeMeter(samples) {
  let export_kWh = 0, import_kWh = 0, peak_kW = 0, min_kW = null, sum_kW = 0, count = 0;
  for (const s of samples) {
    export_kWh += (s.exportDelta_kWh || 0);
    import_kWh += (s.importDelta_kWh || 0);
    const p = s.kW || 0;
    if (min_kW === null || p < min_kW) min_kW = p;
    if (p > peak_kW) peak_kW = p;
    sum_kW += p; count++;
  }
  const avg_kW = count ? sum_kW / count : 0;
  const net_export_kWh = export_kWh - import_kWh;
  const load_factor = peak_kW ? (avg_kW / peak_kW) : 0;

  return {
    export_kWh: round(export_kWh, 2),
    import_kWh: round(import_kWh, 2),
    net_export_kWh: round(net_export_kWh, 2),
    peak_kW: round(peak_kW, 2),
    min_kW: round(min_kW ?? 0, 2),
    avg_kW: round(avg_kW, 2),
    load_factor: round(load_factor, 3)
  };
}

module.exports = { summarizeMeter };



