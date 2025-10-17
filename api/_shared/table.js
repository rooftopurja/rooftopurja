import { DefaultAzureCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";

/**
 * Returns a TableClient using Managed Identity.
 * STORAGE_ACCOUNT_NAME must be set in SWA App Settings.
 */
export function tableClient(tableName) {
  const account = process.env.STORAGE_ACCOUNT_NAME || process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("STORAGE_ACCOUNT_NAME not set.");
  const url = `https://${account}.table.core.windows.net`;
  const cred = new DefaultAzureCredential();
  return new TableClient(url, tableName, cred);
}
