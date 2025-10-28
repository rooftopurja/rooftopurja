const fs = require('fs');
const path = require('path');

// Parse SWA auth header locally if present. In cloud, SWA injects X-MS-CLIENT-PRINCIPAL.
function getUserEmailFromRequest(request) {
  try {
    const hdr = request.headers.get('x-ms-client-principal');
    if (!hdr) return null;
    const json = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
    const emailClaim = (json?.claims || []).find(c => c.typ?.toLowerCase().includes('email'));
    return emailClaim?.val || null;
  } catch { return null; }
}

function loadPlantMap() {
  const p = path.join(__dirname, '..', 'config', 'plant_mapping.dev.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function isAllowedPlant(email, plantId) {
  const cfg = loadPlantMap();
  if (!email) {
    // No auth locally: allow only default plants (prevents random access)
    return (cfg.defaultPlants || []).includes(plantId);
  }
  const user = (cfg.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
  if (!user) return false;
  return (user.plants || []).includes(plantId);
}

module.exports = { getUserEmailFromRequest, isAllowedPlant };