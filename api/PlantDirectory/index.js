"use strict";

const { queryTableAll } = require("../shared/rest");

/*
    PlantDirectory — REST FINAL
    --------------------------
    ✓ Unlimited rows (pagination)
    ✓ JSON only (odata=nometadata)
    ✓ Exact SDK output format
*/

module.exports = async function (context, req) {
    context.log("🌿 PlantDirectory REST START");

    const TABLE = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";

    try {
        // Load ALL rows from table
        const rows = await queryTableAll(TABLE, "");

        context.log(`🌿 PlantDirectory rows: ${rows.length} (REST, paginated)`);

        // Transform like old SDK
        const items = rows.map(r => ({
            Plant_ID: String(r.Plant_ID || r.PartitionKey || ""),
            Plant_Name: r.Plant_Name || "",
            Meters: r.Meters || "",
            CMeters: r.CMeters || "",
            Inverters: (r.Inverters || "")
                .split(",")
                .map(x => x.trim())
                .filter(Boolean)
        }));

        context.res = {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: {
                success: true,
                items,
                total_rows: items.length
            }
        };

    } catch (err) {
        context.log("❌ PlantDirectory ERROR:", err);

        context.res = {
            status: 500,
            headers: { "Content-Type": "application/json" },
            body: {
                success: false,
                error: err.message
            }
        };
    }
};
