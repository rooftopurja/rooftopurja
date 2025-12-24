"use strict";

/*
   FINAL WRITE ENGINE (Verified)
   -----------------------------
   • Pure HTTPS PUT/DELETE
   • No SDK required
   • Fully compatible with new SAS
   • Used by: RepairCache, RepairSummary, Accumulator, Timers
*/

const https = require("https");

// ---------------------------------------------
// Parse SAS + Endpoint
// ---------------------------------------------
const raw = process.env.TABLES_CONNECTION_STRING || "";
let TABLE_ENDPOINT = "";
let TABLE_SAS = "";

try {
    const parts = raw.split(";");
    for (const p of parts) {
        if (p.startsWith("TableEndpoint=")) {
            TABLE_ENDPOINT = p.replace("TableEndpoint=", "").trim().replace(/\/$/, "");
        }
        if (p.startsWith("SharedAccessSignature=")) {
            TABLE_SAS = p.replace("SharedAccessSignature=", "").trim();
        }
    }
} catch (err) {
    console.error("WRITE.JS: SAS parsing error", err);
}

function httpRequest(method, url, body) {
    return new Promise((resolve, reject) => {
        const opts = new URL(url);
        opts.method = method;
        opts.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json;odata=nometadata"
        };

        const req = https.request(opts, res => {
            let buf = "";
            res.on("data", d => buf += d);
            res.on("end", () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
                }
                resolve(buf);
            });
        });

        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ---------------------------------------------
// UPSERT (InsertOrReplace)
// ---------------------------------------------
async function insertOrReplace(tableName, entity) {
    const pk = encodeURIComponent(entity.PartitionKey);
    const rk = encodeURIComponent(entity.RowKey);

    const url =
        `${TABLE_ENDPOINT}/${tableName}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`;

    return httpRequest("PUT", url, entity);
}

// ---------------------------------------------
// DELETE
// ---------------------------------------------
async function deleteEntity(tableName, pk, rk) {
    pk = encodeURIComponent(pk);
    rk = encodeURIComponent(rk);
    const url =
        `${TABLE_ENDPOINT}/${tableName}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`;

    return httpRequest("DELETE", url);
}

module.exports = {
    insertOrReplace,
    deleteEntity
};
