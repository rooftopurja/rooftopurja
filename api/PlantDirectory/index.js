import { DefaultAzureCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

const accountName = process.env.STORAGE_ACCOUNT_NAME || "solariothubstorage";
const tableName = "PlantDirectory";

export default async function (context, req) {
  try {
    let client;
    if (process.env.MSI_ENDPOINT || process.env.IDENTITY_ENDPOINT) {
      const cred = new DefaultAzureCredential();
      const url = `https://${accountName}.table.core.windows.net`;
      client = new TableClient(url, tableName, cred);
    } else if (process.env.AZURE_TABLES_CONNECTION_STRING) {
      client = TableClient.fromConnectionString(process.env.AZURE_TABLES_CONNECTION_STRING, tableName);
    } else if (process.env.AZURE_STORAGE_ACCOUNT_KEY) {
      const cred = new AzureNamedKeyCredential(accountName, process.env.AZURE_STORAGE_ACCOUNT_KEY);
      const url = `https://${accountName}.table.core.windows.net`;
      client = new TableClient(url, tableName, cred);
    } else {
      throw new Error("No storage credentials configured.");
    }

    const out = [];
    for await (const e of client.listEntities()) {
      out.push({
        id: String(e.Plant_ID ?? e.RowKey ?? e.PartitionKey ?? ""),
        name: String(e.DisplayPlant ?? e.Plant_Name ?? e.Name ?? e.RowKey ?? "")
      });
    }
    out.sort((a,b)=>a.name.localeCompare(b.name));
    context.res = { status: 200, headers: { "content-type":"application/json" }, body: { plants: out } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: String(err.message || err) } };
  }
}
