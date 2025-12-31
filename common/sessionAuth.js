"use strict";

const https = require("https");

const ACCOUNT = "solariothubstorage";
const TABLE_SAS = process.env.TABLE_SAS || process.env.TABLE_STORAGE_SAS;
const TABLE_ENDPOINT = `https://${ACCOUNT}.table.core.windows.net`;

function tableGET(url) {
  return new Promise((resolve) => {
    https.get(
      url,
      { headers: { Accept: "application/json;odata=nometadata" } },
      res => {
        let buf = "";
        res.on("data", d => buf += d);
        res.on("end", () => {
          if (res.statusCode >= 400) return resolve(null);
          resolve(JSON.parse(buf || "{}"));
        });
      }
    ).on("error", () => resolve(null));
  });
}

module.exports.validateSession = async function (token) {
  if (!token) return null;

  const url =
    `${TABLE_ENDPOINT}/UserSessions` +
    `(PartitionKey='${token}',RowKey='session')?${TABLE_SAS}`;

  const row = await tableGET(url);
  if (!row) return null;

  if (String(row.Status) !== "active") return null;
  if (Date.now() > new Date(row.ExpiresAt).getTime()) return null;

  return row.Email;
};
