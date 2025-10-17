import { tableClient } from "../_shared/table.js";

export default async function (context, req) {
  try {
    const client = tableClient("PlantDirectory");
    const out = [];
    for await (const e of client.listEntities()) {
      // Flexible name discovery: DisplayPlant or Plant_Name
      const name =
        (e.DisplayPlant && String(e.DisplayPlant).trim()) ||
        (e.Plant_Name && String(e.Plant_Name).trim()) ||
        "";
      const id =
        (e.Plant_ID != null && String(e.Plant_ID).trim()) ||
        (e.RowKey && String(e.RowKey).trim()) ||
        (e.PartitionKey && String(e.PartitionKey).trim()) ||
        "";

      if (name && id) out.push({ Plant_ID: id, DisplayPlant: name });
    }

    // Stable sort
    out.sort((a, b) => String(a.DisplayPlant).localeCompare(String(b.DisplayPlant)));

    context.res = { status: 200, headers: { "content-type": "application/json" }, body: out };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: String(err?.message || err) } };
  }
}
