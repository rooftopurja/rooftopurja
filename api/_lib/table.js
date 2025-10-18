import { ManagedIdentityCredential, DefaultAzureCredential } from "@azure/identity";
import { TableClient, TableServiceClient } from "@azure/data-tables";

/** Prefer connection string; fall back to MSI. */
export function makeClients(accountName, tableName) {
  const cs = process.env.TABLES_CONNECTION_STRING || process.env.STORAGE_CONNECTION_STRING;
  if (cs) {
    return {
      table: TableClient.fromConnectionString(cs, tableName),
      service: TableServiceClient.fromConnectionString(cs)
    };
  }
  const url = `https://${accountName}.table.core.windows.net`;
  // DefaultAzureCredential includes MSI and is more resilient than MSI-only
  const cred = new DefaultAzureCredential({ excludeEnvironmentCredential: true });
  return {
    table: new TableClient(url, tableName, cred),
    service: new TableServiceClient(url, cred)
  };
}

export function parseStart(s){
  if(!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  return new Date(iso+"T00:00:00Z");
}
export function parseEnd(s){
  if(!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  return new Date(iso+"T23:59:59Z");
}
