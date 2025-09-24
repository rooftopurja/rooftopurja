const { app } = require('@azure/functions');

app.http('maintenance_overview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'maintenance/overview',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const plantId = (url.searchParams.get('plantId') || '').trim();
    const deviceType = (url.searchParams.get('type') || '').toLowerCase(); // '', 'plc', 'lora'
    const top = Math.min(parseInt(url.searchParams.get('top') || '20', 10), 200);

    if (!plantId) {
      return { status: 400, jsonBody: { error: 'plantId is required' } };
    }

    // MOCK rows (replace with SQL reads from plcaccontrol, plcpumpcontrol, lora_xxx tables later)
    const now = Date.now();
    const base = Array.from({ length: top }).map((_, i) => ({
      plantId,
      timestamp: new Date(now - i * 5 * 60000).toISOString(),
      source: (i % 3 === 0) ? 'plcaccontrol' : (i % 3 === 1) ? 'plcpumpcontrol' : 'lora',
      deviceId: (i % 3 === 2) ? ('LoRa-' + (100 + i)) : ('PLC-' + (10 + i)),
      status: (i % 7 === 0) ? 'Fault' : (i % 5 === 0) ? 'Maintenance Due' : 'OK',
      message: (i % 7 === 0) ? 'Overcurrent detected' : (i % 5 === 0) ? 'Filter replacement due' : 'Normal',
      ack: (i % 4 === 0),
      severity: (i % 7 === 0) ? 'Major' : (i % 5 === 0) ? 'Minor' : 'Info'
    }));

    const data = base.filter(r => {
      if (!deviceType) return true;
      if (deviceType === 'plc') return r.source !== 'lora';
      if (deviceType === 'lora') return r.source === 'lora';
      return true;
    });

    return { jsonBody: { ok: true, count: data.length, data } };
  }
});
