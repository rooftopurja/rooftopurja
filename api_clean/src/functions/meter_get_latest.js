const { app } = require('@azure/functions');
const { getUserEmailFromRequest, isAllowedPlant } = require('../shared/rls');

app.http('meter_get_latest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'meter/latest',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const top = Math.min(parseInt(url.searchParams.get('top') || '10', 10), 100);

    if (!plantId) return { status: 400, jsonBody: { error: 'plantId is required' } };

    // RLS check
    const email = getUserEmailFromRequest(request);
    if (!isAllowedPlant(email, plantId)) {
      return { status: 403, jsonBody: { error: 'forbidden for plant ' + plantId } };
    }

    // MOCK rows (replace later with Azure Table read)
    const now = Date.now();
    const data = Array.from({ length: top }).map((_, i) => ({
      plantId,
      meterNo: 'P300-DEM-001',
      timestamp: new Date(now - i * 60000).toISOString(),
      kWh_Export: 123456.78 + i,
      kWh_Import: 234.56,
      kW: +(98.7 - i * 0.1).toFixed(2),
      voltage_V: 415.0,
      current_A: 143.2,
      frequency_Hz: 50.0
    }));

    return { jsonBody: { ok: true, count: data.length, data } };
  }
});



