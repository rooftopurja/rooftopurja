const { app } = require('@azure/functions');
const { getUserEmailFromRequest, isAllowedPlant } = require('../shared/rls');
const { summarizeMeter } = require('../shared/measures');

app.http('meter_summary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'meter/summary',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const minutes = Math.min(parseInt(url.searchParams.get('minutes') || '120', 10), 1440); // default 2h, cap 24h

    if (!plantId) return { status: 400, jsonBody: { error: 'plantId is required' } };

    // RLS
    const email = getUserEmailFromRequest(request);
    if (!isAllowedPlant(email, plantId)) {
      return { status: 403, jsonBody: { error: 'forbidden for plant ' + plantId } };
    }

    // MOCK time-series (every 5 minutes). Later: replace with Azure Tables (Premier300Meter).
    const step = 5; // minutes
    const points = Math.max(1, Math.floor(minutes/step));
    const now = Date.now();

    // Simple diurnal profile: peak around mid window
    const series = [];
    for (let i = points - 1; i >= 0; i--) {
      const t = new Date(now - i * step * 60000);
      // pseudo solar shape (0..1)
      const phase = (points - i) / points;
      const shape = Math.max(0, Math.sin(Math.PI * phase)); // 0 at ends, 1 in middle
      const kW = +(80 + 60*shape + (Math.random() - 0.5)*4).toFixed(2); // ~80..140 kW
      const exportDelta = +(kW * (step/60)).toFixed(3); // kW * hours = kWh
      const importDelta = +((Math.random()<0.15 ? 0.02 : 0) * (step/60)).toFixed(3); // small aux import
      series.push({
        timestamp: t.toISOString(),
        kW,
        exportDelta_kWh: exportDelta,
        importDelta_kWh: importDelta,
        intervalMin: step
      });
    }

    const kpis = summarizeMeter(series);

    return {
      jsonBody: {
        ok: true,
        window_min: minutes,
        plantId,
        kpis,
        series
      }
    };
  }
});



