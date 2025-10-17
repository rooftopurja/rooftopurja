import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { TableClient, AzureSASCredential, AzureNamedKeyCredential } from "@azure/data-tables";

function pickConnString() {
  return process.env.TABLES_CONN
      || process.env.TABLES_CONNECTION_STRING
      || process.env.STORAGE_CONNECTION_STRING
      || "";
}

export function makeTable(accountName, tableName){
  const conn = pickConnString();
  if (conn) {
    // Connection string path
    return TableClient.fromConnectionString(conn, tableName);
  }
  // Managed identity path
  const acct = accountName || process.env.STORAGE_ACCOUNT_NAME;
  if (!acct) throw new Error("No storage account configured. Set STORAGE_ACCOUNT_NAME or a connection string env var.");

  const url = `https://${acct}.table.core.windows.net`;
  // SWA managed identity (system-assigned) works with DefaultAzureCredential
  const cred = new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID });
  return new TableClient(url, tableName, cred);
}
