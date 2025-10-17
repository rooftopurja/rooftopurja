import { tableClient, queryRows } from "../shared/azure.js";

/**
 * GET /api/plants
 * Reads PlantDirectory and returns:
 *  - plants: [{ plantId, name }]
 *  - invertersByPlant: { [plantId]: [ inverterIds... ] }
 *
 * Handles rows with/without Plant_ID.
 */
export default async function (context, req) {
  try {
    const plantTable = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const cli = tableClient(plantTable);

    // Pull a reasonable page; you can widen later if directory grows huge
    const rows = await queryRows(cli, undefined, 5000);

    const plants = new Map(); // plantId -> name
    const byPlant = new Map(); // plantId -> Set(inverterIds)

    for (const r of rows) {
      const plantId = (r.Plant_ID ?? r.PlantId ?? r.plantId ?? "").toString().trim();
      const name = (r.DisplayPlant || r.Plant_Name || r.PlantName || "").toString().trim();
      const inv = (r.Inverter_ID || r.InverterID || r.InverterId || "").toString().trim();

      if (plantId) {
        if (name) plants.set(plantId, name);
        if (!byPlant.has(plantId)) byPlant.set(plantId, new Set());
        if (inv) byPlant.get(plantId).add(inv);
      }
    }

    const plantArray = [...plants.entries()].map(([plantId, name]) => ({ plantId, name }));
    const mapped = {};
    for (const [pid, set] of byPlant.entries()) mapped[pid] = [...set].sort();

    context.res = { status: 200, jsonBody: { plants: plantArray, invertersByPlant: mapped } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, jsonBody: { error: String(err?.message || err) } };
  }
}
