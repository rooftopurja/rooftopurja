import { makeTable } from "../shared/azure.js";

export default async function (context, req) {
  try {
    const account = process.env.STORAGE_ACCOUNT_NAME; // optional if using conn string
    // directory table that has Plant_ID + Inverter_ID mapping
    const table = makeTable(account, process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory");

    // read basic plant & inverter map
    const rows = [];
    for await (const e of table.listEntities()) {
      rows.push({
        plantId: e.Plant_ID ?? e.PlantId ?? e.PartitionKey ?? "",
        plantName: e.Plant_Name ?? e.Plant ?? e.DisplayPlant ?? "",
        inverterId: e.Inverter_ID ?? e.InverterId ?? "",
      });
    }

    // Build unique plant list + inverter list for dropdowns
    const plantMap = new Map();
    const inverters = new Set();
    for (const r of rows) {
      const pid = (r.plantId||"").toString();
      if (pid && !plantMap.has(pid)) {
        plantMap.set(pid, r.plantName || pid);
      }
      if (r.inverterId) inverters.add(r.inverterId.toString());
    }

    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        plants: [...plantMap.entries()].map(([id,name])=>({ id, name })),
        inverters: [...inverters].sort()
      }
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: String(err?.message||err) } };
  }
}
