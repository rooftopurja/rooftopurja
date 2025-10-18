import { TableClient, TableServiceClient } from "@azure/data-tables";

/** Build clients strictly from TABLES_CONNECTION_STRING (or STORAGE_CONNECTION_STRING). */
export function makeClients(accountNameIgnored, tableName) {
  const cs =
    process.env.TABLES_CONNECTION_STRING ||
    process.env.STORAGE_CONNECTION_STRING ||
    process.env.TABLES_CONNECTION; // any of your older names

  if (!cs) {
    const msg =
      "Missing TABLES_CONNECTION_STRING (or STORAGE_CONNECTION_STRING). Set it in SWA -> Environment variables.";
    throw new Error(msg);
  }

  return {
    table: TableClient.fromConnectionString(cs, tableName),
    service: TableServiceClient.fromConnectionString(cs)
  };
}

/** Helpers used by meter endpoint */
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
