const { app } = require('@azure/functions');
const { getUserEmailFromRequest, isAllowedPlant } = require('../shared/rls');

app.http('inverter_data_overview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'inverter/data/overview',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const top = Math.min(parseInt(url.searchParams.get('top') || '20', 10), 200);

    if (!plantId) return { status: 400, jsonBody: { error: 'plantId is required' } };

    // RLS
    const email = getUserEmailFromRequest(request);
    if (!isAllowedPlant(email, plantId)) {
      return { status: 403, jsonBody: { error: 'forbidden for plant ' + plantId } };
    }

    // MOCK rows (replace later with Azure Table reads)
    const now = Date.now();
    const data = Array.from({ length: top }).map((_, i) => ({
      plantId,
      inverterId: 'SG125-INV-' + ((i % 6) + 1).toString().padStart(2, '0'),
      timestamp: new Date(now - i * 60000).toISOString(),
      acPower_kW: +(120 - i * 0.3).toFixed(2),
      dcVoltage_V: +(940 - i * 0.5).toFixed(1),
      dcCurrent_A: +(150 - i * 0.4).toFixed(1),
      mpptCount: 10,
      temp_C: +(45 - i * 0.05).toFixed(1),
      status: (i % 25 === 0) ? 'Warning' : 'Normal'
    }));

    return { jsonBody: { ok: true, count: data.length, data } };
  }
});


