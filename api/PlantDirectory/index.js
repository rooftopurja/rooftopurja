import { TableClient } from "@azure/data-tables";

const TABLE_CONN = process.env.TABLES_CONNECTION_STRING || process.env.STORAGE_CONNECTION_STRING;
const TABLE_NAME = "PlantDirectory";

export default async function (context, req) {
  try {
    if (!TABLE_CONN) throw new Error("Missing TABLES_CONNECTION_STRING");

    const client = TableClient.fromConnectionString(TABLE_CONN, TABLE_NAME);

    // Read all rows, map to {id,name}
    const out = [];
    for await (const entity of client.listEntities()) {
      const id = String(entity.Plant_ID ?? entity.PlantId ?? "").trim();
      const name =
        String(entity.DisplayPlant ?? entity.Plant_Name ?? entity.Name ?? id).trim();
      if (id) out.push({ id, name });
    }

    // Sort for a clean dropdown
    out.sort((a,b) => a.name.localeCompare(b.name));

    context.res = {
      headers: { "Content-Type": "application/json" },
      body: { plants: out }
    };
  } catch (err) {
    context.log.error("PlantDirectory error:", err?.message || err);
    context.res = { status: 500, body: { error: String(err?.message || err) } };
  }
}