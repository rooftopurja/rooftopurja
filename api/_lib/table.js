import { ManagedIdentityCredential } from "@azure/identity";
import { TableClient, TableServiceClient } from "@azure/data-tables";

/** Prefer MSI; fall back to TABLES_CONNECTION_STRING if provided. */
export function makeClients(accountName, tableName) {
  const cs = process.env.TABLES_CONNECTION_STRING || process.env.STORAGE_CONNECTION_STRING;
  if (cs) {
    return {
      table: TableClient.fromConnectionString(cs, tableName),
      service: TableServiceClient.fromConnectionString(cs)
    };
  }
  const url = `https://${accountName}.table.core.windows.net`;
  const cred = new ManagedIdentityCredential(); // works with SWA system-assigned MI
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
