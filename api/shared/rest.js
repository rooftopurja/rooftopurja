"use strict";

const https = require("https");

/* --------------------------------------------------------------
   PARSE TABLES_CONNECTION_STRING
-------------------------------------------------------------- */
const RAW = process.env.TABLES_CONNECTION_STRING || "";
const PARTS = RAW.split(";");

let ENDPOINT = "";
let SAS = "";

for (const p of PARTS) {
    if (p.startsWith("TableEndpoint=")) {
        ENDPOINT = p.replace("TableEndpoint=", "").replace(/\/+$/, "");
    }
    if (p.startsWith("SharedAccessSignature=")) {
        SAS = p.replace("SharedAccessSignature=", "")
               .replace(/^\?+/, "");   // REMOVE any leading ?
    }
}

console.log("🌐 REST.JS INITIALIZED");
console.log("🔹 TableEndpoint:", ENDPOINT);
console.log("🔹 SAS length:", SAS.length);

/* --------------------------------------------------------------
   HTTPS GET HELPER
-------------------------------------------------------------- */
function httpGET(url) {
    return new Promise((resolve, reject) => {
        https.get(
            url,
            { headers: { "Accept": "application/json;odata=nometadata" }},
            res => {
                let body = "";
                res.on("data", chunk => body += chunk);
                res.on("end", () => {
                    if (res.statusCode >= 400) {
                        return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                    }
                    try { resolve(JSON.parse(body)); }
                    catch (err) {
                        reject(new Error("JSON parse failed: " + err + "\nBODY=" + body));
                    }
                });
            }
        ).on("error", reject);
    });
}

/* --------------------------------------------------------------
   TABLE QUERY (Paged)
-------------------------------------------------------------- */
async function queryTableAll(table, filter = "") {
    let results = [];
    let nextPK = null;
    let nextRK = null;

    do {
        let url = `${ENDPOINT}/${table}()?$top=1000`;

if (filter)
    url += `&$filter=${encodeURIComponent(filter)}`;

if (nextPK)
    url += `&NextPartitionKey=${encodeURIComponent(nextPK)}`;

if (nextRK)
    url += `&NextRowKey=${encodeURIComponent(nextRK)}`;

// Append SAS correctly
url += "&" + SAS;

const json = await httpGET(url);

        if (json.value)
            results.push(...json.value);

        nextPK = json["odata.nextPartitionKey"];
        nextRK = json["odata.nextRowKey"];

    } while (nextPK && nextRK);

    return results;
}

module.exports = { queryTableAll };
