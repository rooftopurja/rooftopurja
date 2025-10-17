import { tableClient } from "../_shared/table.js";

export default async function (context, req) {
  try {
    const client = tableClient("PlantDirectory");
    const plants = [];
    for await (const e of client.listEntities()) {
      const name =
        (e.DisplayPlant && String(e.DisplayPlant).trim()) ||
        (e.Plant_Name && String(e.Plant_Name).trim()) || "";
      const id =
        (e.Plant_ID != null && String(e.Plant_ID).trim()) ||
        (e.RowKey && String(e.RowKey).trim()) ||
        (e.PartitionKey && String(e.PartitionKey).trim()) || "";
      if (name && id) plants.push({ id, name });
    }
    plants.sort((a,b)=>a.name.localeCompare(b.name));
    context.res = { status: 200, headers: { "content-type": "application/json" }, body: { plants } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: String(err?.message || err) } };
  }
}
