const { TableClient } = require("@azure/data-tables");

/**
 * Unified low-cost data reader for all plant types (Meters, Inverters, Sensors, PLCs)
 * Reads tables dynamically from SWA environment variables.
 */
module.exports = async function (context, req) {
  try {
    // 1️⃣ Get authenticated user
    const principal = req.headers["x-ms-client-principal"];
    if (!principal) {
      context.res = { status: 401, body: "Not authenticated" };
      return;
    }
    const decoded = Buffer.from(principal, "base64").toString("utf8");
    const user = JSON.parse(decoded);
    const userId = user.userId || user.userDetails;
    if (!userId) {
      context.res = { status: 401, body: "User ID missing" };
      return;
    }

    // 2️⃣ Get environment variables
    const conn = process.env.TABLES_CONNECTION_STRING;
    const meterTables = (process.env.METER_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);
    const inverterTables = (process.env.INVERTER_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);
    const sensorTables = (process.env.SENSORS_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);
    const plcTables = (process.env.plcaccontrol_tables + "," + process.env.plcpump_tables)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // 3️⃣ Determine which plants this user can see
    const accessClient = TableClient.fromConnectionString(conn, "UserPlantAccess");
    const allowedPlants = [];
    for await (const e of accessClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${userId}'` },
    })) {
      allowedPlants.push(e.Plant_ID.toString());
    }
    if (allowedPlants.length === 0) {
      context.res = { status: 403, body: "No plants assigned to this user." };
      return;
    }

    // Helper to load rows for one table
    async function fetchTableRows(tableName) {
      try {
        const client = TableClient.fromConnectionString(conn, tableName);
        const rows = [];
        for (const plantId of allowedPlants) {
          for await (const entity of client.listEntities({
            queryOptions: { filter: `PartitionKey eq '${plantId}'` },
          })) {
            rows.push({ tableName, plantId, ...entity });
            if (rows.length >= 500) break; // limit per table
          }
        }
        return rows;
      } catch (err) {
        context.log(`Error reading ${tableName}: ${err.message}`);
        return [];
      }
    }

    // 4️⃣ Collect all categories
    const [meters, inverters, sensors, plcs] = await Promise.all([
      Promise.all(meterTables.map(fetchTableRows)),
      Promise.all(inverterTables.map(fetchTableRows)),
      Promise.all(sensorTables.map(fetchTableRows)),
      Promise.all(plcTables.map(fetchTableRows)),
    ]);

    // Flatten arrays
    const result = {
      user: userId,
      plants: allowedPlants,
      meters: meters.flat(),
      inverters: inverters.flat(),
      sensors: sensors.flat(),
      plc: plcs.flat(),
    };

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result,
    };
  } catch (err) {
    context.log.error("Error in GetAllPlantData:", err);
    context.res = { status: 500, body: `Server error: ${err.message}` };
  }
};
