const { app } = require('@azure/functions');

// GET /api/meter/dashboard?plantName=Demo%20Plant&start=YYYY-MM-DD&end=YYYY-MM-DD
app.http('meter_dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'meter/dashboard',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantName = (url.searchParams.get('plantName') || 'Demo Plant').trim();
    const start = url.searchParams.get('start') || '';
    const end   = url.searchParams.get('end') || '';

    // Map user-facing name to an id your other APIs expect
    const plantId = plantName === 'Demo Plant' ? 'DEMO' : plantName;

    // Build 9 days of sample points so the UI can render now
    const days = 9;
    const ref = end ? new Date(end) : new Date();
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(ref);
      d.setDate(d.getDate() - i);
      const dd = d.toISOString().slice(0, 10);
      // Mock numbers just for layout/testing
      const totalMWh = 1750 + (i % 3) * 40;      // bar (MWh)
      const incKWh   = 420  + (i % 4) * 35;      // line (kWh)
      daily.push({ date: dd, total_yield_mwh: totalMWh, incremental_yield_kwh: incKWh });
    }

    // KPI + pie sample (units included so tooltips can show them)
    const kpi = { value: 1.791, unit: 'GWh', label: 'Total Yield' };
    const pie = [
      { name: 'P300-001', value: 486.15, unit: 'MWh' },
      { name: 'P300-002', value: 354.62, unit: 'MWh' },
      { name: 'P300-003', value: 356.40, unit: 'MWh' },
      { name: 'P300-004', value: 594.18, unit: 'MWh' },
    ];

    return {
      jsonBody: {
        ok: true,
        plantId,
        range: { start, end },
        kpi,
        daily,   // for bar/line with dual Y-axes
        pie      // for contribution chart
      }
    };
  }
});
