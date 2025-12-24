"use strict";

/**
 * Bulletproof parser for TABLES_CONNECTION_STRING
 * Supports SAS copied from Azure Portal exactly as-is
 * Ensures no malformed URLs are generated for REST writes.
 */
function parseConnectionString(connStr) {
    if (!connStr || typeof connStr !== "string") {
        throw new Error("TABLES_CONNECTION_STRING missing or invalid");
    }

    let endpoint = "";
    let sas = "";

    const parts = connStr.split(";");

    for (const raw of parts) {
        const p = raw.trim();

        // Extract endpoint
        if (p.startsWith("TableEndpoint=")) {
            endpoint = p.replace("TableEndpoint=", "").trim();
            endpoint = endpoint.replace(/\/+$/, "");  // remove trailing slash
        }

        // Extract SAS token
        if (p.startsWith("SharedAccessSignature=")) {
            sas = p.replace("SharedAccessSignature=", "").trim();

            // SAS pasted from portal often has leading "?"
            if (sas.startsWith("?")) sas = sas.substring(1);

            // Absolute safety: remove ANY leading "?"
            while (sas.startsWith("?")) sas = sas.substring(1);
        }
    }

    if (!endpoint) {
        throw new Error("TABLES_CONNECTION_STRING missing TableEndpoint");
    }

    if (!sas) {
        throw new Error("TABLES_CONNECTION_STRING missing SharedAccessSignature");
    }

    return { endpoint, sas };
}

module.exports = { parseConnectionString };
