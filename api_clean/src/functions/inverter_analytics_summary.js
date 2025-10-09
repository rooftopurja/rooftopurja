const { app } = require('@azure/functions');

// Placeholder: computes simple PR & CUF summary from mock inverter + sensors data.
// We will later replace this with real SQL joins on SungrowInverterMerged & SivaraSensors.
app.http('inverter_analytics_summary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'inverter/analytics/summary',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const days = Math.max(1, Math.min(31, parseInt(url.searchParams.get('days') || '1', 10)));

    if (!plantId) {
      return { status: 400, jsonBody: { error: 'plantId is required' } };
    }

    // --- MOCK DATA (to be swapped with SQL later) ---
    // Assume plant capacity 1 MW, irradiance 5 kWh/m^2/day, inverter yield ~0.8, CUF around 0.24
    const capacityMW = 1.0;
    const capacityKW = capacityMW * 1000;
    const energyExportKWh = Math.round(240 * days);     // ~240 kWh/day
    const theoreticalKWh  = Math.round(capacityKW * 24 * 0.24 * days); // same scale for demo
    const pr = +(energyExportKWh / Math.max(1, theoreticalKWh)).toFixed(2); // ~1.0 in mock
    const cuf = +((energyExportKWh / (capacityKW * 24 * days))).toFixed(2); // ~0.24 in mock

    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      jsonBody: {
        ok: true,
        plantId,
        windowDays: days,
        from: from.toISOString(),
        to: now.toISOString(),
        capacityMW,
        energyExportKWh,
        theoreticalKWh,
        PR: pr,
        CUF: cuf
      }
    };
  }
});


