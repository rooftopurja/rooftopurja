import { DefaultAzureCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";

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

export function getClient(accountName, tableName){
  const url = `https://${accountName}.table.core.windows.net`;
  const cred = new DefaultAzureCredential();
  return new TableClient(url, tableName, cred);
}
