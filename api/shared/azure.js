import { DefaultAzureCredential } from "@azure/identity";
import { TableServiceClient } from "@azure/data-tables";

/**
 * Builds a TableServiceClient using:
 * 1) TABLES_CONN (connection string), or
 * 2) STORAGE_ACCOUNT_NAME + Managed Identity (DefaultAzureCredential)
 */
export function getServiceClient() {
  const conn = process.env.TABLES_CONN;
  const acct = process.env.STORAGE_ACCOUNT_NAME || process.env.STORAGE_ACCOUNT || process.env.AZURE_STORAGE_ACCOUNT;
  if (conn && conn.trim()) {
    return TableServiceClient.fromConnectionString(conn);
  }
  if (!acct) throw new Error("Missing STORAGE_ACCOUNT_NAME (or TABLES_CONN).");
  const url = `https://${acct}.table.core.windows.net`;
  const cred = new DefaultAzureCredential();
  return new TableServiceClient(url, cred);
}

export async function listTablesWithPrefix(prefix) {
  const svc = getServiceClient();
  const out = [];
  for await (const t of svc.listTables()) {
    if (!prefix || t.name.toLowerCase().startsWith(prefix.toLowerCase())) out.push(t.name);
  }
  return out;
}

export function tableClient(tableName) {
  const svc = getServiceClient();
  return svc.getTableClient(tableName);
}

/** Pulls rows with a simple filter and limit (defensive paging). */
export async function queryRows(client, filter, top = 1000) {
  const rows = [];
  const iter = client.listEntities({ queryOptions: { filter, top } });
  for await (const r of iter) rows.push(r);
  return rows;
}
