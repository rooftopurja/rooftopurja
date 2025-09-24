const { app } = require('@azure/functions');
const { getUserEmailFromRequest, isAllowedPlant } = require('../shared/rls');

app.http('inverter_faults_list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'inverter/faults',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const top = Math.min(parseInt(url.searchParams.get('top') || '20', 10), 200);
    const onlyActive = (url.searchParams.get('active') || 'true').toLowerCase() === 'true';

    if (!plantId) return { status: 400, jsonBody: { error: 'plantId is required' } };

    // RLS
    const email = getUserEmailFromRequest(request);
    if (!isAllowedPlant(email, plantId)) {
      return { status: 403, jsonBody: { error: 'forbidden for plant ' + plantId } };
    }

    // MOCK faults (replace later with real)
    const now = Date.now();
    const severities = ['Critical','Major','Minor','Warning','Info'];
    const codes = ['E101','E207','E315','W042','I010'];
    const msgs = { E101:'DC insulation low', E207:'Grid overvoltage', E315:'IGBT overtemperature', W042:'MPPT mismatch', I010:'Self-check complete' };

    const data = Array.from({ length: top }).map((_, i) => {
      const sev = severities[i % severities.length];
      const code = codes[i % codes.length];
      return {
        plantId,
        inverterId: 'SG125-INV-' + ((i % 6) + 1).toString().padStart(2,'0'),
        code,
        severity: sev,
        message: msgs[code],
        timestamp: new Date(now - i * 5 * 60000).toISOString(),
        active: i % 4 !== 0,
        acknowledged: i % 5 === 0
      };
    }).filter(f => (onlyActive ? f.active : true));

    return { jsonBody: { ok: true, count: data.length, data } };
  }
});
