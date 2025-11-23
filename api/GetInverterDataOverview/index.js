"use strict";

const { TableClient } = require("@azure/data-tables");

// MUST exist for SWA emulator
const conn = process.env.TABLES_CONNECTION_STRING;
if (!conn) throw new Error("TABLES_CONNECTION_STRING missing");

module.exports = async function (context, req) {
    try {
        const plant = (req.query.plant || "").trim();
        const inverter = (req.query.inverter || "").trim();
        const date = (req.query.date || "").trim();

        if (!plant || !inverter || !date) {
            context.res = {
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: {
                    success: false,
                    message: "Parameters missing",
                    inverter,
                    date,
                    record: null
                }
            };
            return;
        }

        // Load PlantDirectory to confirm inverter belongs to plant
        const dir = TableClient.fromConnectionString(conn, "PlantDirectory");
        let inverterList = [];

        for await (const row of dir.listEntities()) {
            if (row.Plant_Name === plant) {
                inverterList = Array.isArray(row.Inverters)
                    ? row.Inverters
                    : String(row.Inverters || "")
                        .split(",")
                        .map(s => s.trim())
                        .filter(Boolean);
            }
        }

        if (!inverterList.includes(inverter)) {
            context.res = {
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: {
                    success: false,
                    message: "Inverter not part of plant",
                    inverter,
                    date,
                    record: null
                }
            };
            return;
        }

        // Scan all inverter tables
        const tables = (process.env.INVERTER_TABLES || "")
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);

        let latest = null;

        for (const tableName of tables) {
            const client = TableClient.fromConnectionString(conn, tableName);

            // Correct filter: PartitionKey + Date
            const filter = `PartitionKey eq '${inverter}' and Date eq '${date}'`;

            for await (const row of client.listEntities({ queryOptions: { filter } })) {

                // determine time column
                let t =
                    row.DateTime ||
                    row.Date_Time ||
                    row.Timestamp ||
                    row.Date ||
                    null;

                if (!t) continue;

                const dt = new Date(t);
                if (!latest || dt > new Date(latest.__time)) {
                    row.__time = dt.toISOString();
                    latest = row;
                }
            }
        }

        if (!latest) {
            context.res = {
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: {
                    success: false,
                    message: `No inverter data for ${inverter} on ${date}`,
                    inverter,
                    date,
                    record: null
                }
            };
            return;
        }

        // SUCCESS OUTPUT
        context.res = {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
                success: true,
                inverter,
                date,
                record: latest
            }
        };

    } catch (err) {
        context.log("GetInverterDataOverview ERROR:", err);
        context.res = {
            status: 500,
            headers: { "Content-Type": "application/json" },
            body: { success: false, error: err.message }
        };
    }
};
