"use strict";

const { TableClient } = require("@azure/data-tables");

module.exports = async function GetMeterData(context, req) {
  try {
    const connStr = process.env.TABLES_CONNECTION_STRING;
    if (!connStr)
      throw new Error("TABLES_CONNECTION_STRING missing in environment variables.");

    // tables
    const DIR_TABLE = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const METER_TABLE = process.env.METER_TABLES || "Premier300Meter";

    // ---- Auth ----
    let email = "anonymous@user.com";
    const principal = req.headers["x-ms-client-principal"];
    if (principal) {
      try {
        const obj = JSON.parse(Buffer.from(principal, "base64").toString("utf8"));
        email = (obj.userDetails || "anonymous@user.com").toLowerCase();
      } catch (_) {}
    }

    // ---- Load PlantDirectory ----
    const dirClient = TableClient.fromConnectionString(connStr, DIR_TABLE);
    const plantMap = {};
    const plantByMeter = {};

    for await (const row of dirClient.listEntities()) {
      plantMap[row.Plant_ID] = row;

      if (row.Meter_ID) {
        plantByMeter[String(row.Meter_ID)] = row.Plant_ID;
      }
    }

    // ---- Read all Meter rows ----
    const meterClient = TableClient.fromConnectionString(connStr, METER_TABLE);
    const rows = [];

    for await (const r of meterClient.listEntities()) {
      const rawDate =
        r.Date_Time || r.Timestamp || r.Date || r.DateTime || r["date_time"];

      if (!rawDate) continue;
      const dt = new Date(rawDate);
      if (isNaN(dt)) continue;

      const meterId = r.Meter_ID || r.PartitionKey || null;
      if (!meterId) continue;

      const pid = r.Plant_ID || plantByMeter[meterId] || null;
      if (!pid) continue;

      r.__date = dt;
      r.Plant_ID = pid;
      rows.push(r);
    }

    if (!rows.length) {
      context.res = {
        headers: { "Content-Type": "application/json" },
        body: {
          user: email,
          plants: [],
          latestReadings: [],
          dailyData: {},
          dailyByPlant: {},
          tableByDate: {},
          history: { monthlyByPlant: {}, yearlyByPlant: {} },
          pieData: [],
          lastUpdated: new Date().toISOString(),
          totalYield: "0",
          yieldUnit: "kWh"
        }
      };
      return;
    }

    // ---- Utility fns ----
    const toISO = (d) => new Date(d).toISOString().slice(0, 10);
    const toKWh = (val, unit) => {
      const n = Number(val) || 0;
      if (!unit) return n;
      const u = unit.toLowerCase();
      if (u.includes("gwh")) return n * 1e6;
      if (u.includes("mwh")) return n * 1e3;
      return n;
    };

    // ---- Pick closest reading to 09:50 per meter & date ----
    const TARGET = 9 * 60 + 50;
    const byMeterDate = {};

    for (const r of rows) {
      const meterId = r.Meter_ID || r.PartitionKey;
      const d = r.__date;

      const ymd = toISO(d);
      const minutes = d.getHours() * 60 + d.getMinutes();
      const diff = Math.abs(minutes - TARGET);

      const key = `${meterId}_${ymd}`;
      if (!byMeterDate[key] || diff < byMeterDate[key].diff) {
        byMeterDate[key] = { row: r, diff };
      }
    }

    const filtered = Object.values(byMeterDate).map((x) => x.row);

    // ---- Latest per plant ----
    const latestByPlant = {};
    for (const r of filtered) {
      const pid = r.Plant_ID;
      const ts = r.__date;
      if (!latestByPlant[pid] || ts > latestByPlant[pid].__date)
        latestByPlant[pid] = r;
    }

    const latestReadings = Object.values(latestByPlant).map((r) => ({
      Plant_ID: r.Plant_ID,
      Plant_Name: plantMap[r.Plant_ID]?.Plant_Name || r.Plant_ID,
      Meter_ID: r.Meter_ID || "",
      Meter_Serial_No: r.Meter_Serial_No || "",
      Meter_Make: r.Meter_Make || "",
      Meter_Model: r.Meter_Model || "",
      Meter_Type: r.Meter_Type || "",
      Meter_Reading: r.Meter_Reading || "",
      Total_Yield: toKWh(r.Total_Yield, r.Yield_Unit),
      Incremental_Daily_Yield_KWH: Number(r.Incremental_Daily_Yield_KWH) || 0,
      Date_Time: r.__date.toISOString()
    }));

    // ---- Daily & Table calculations (last 31 days) ----
    const dailyByPlant = {};
    const tableByDate = {};
    const now = new Date();
    const cutoff = new Date(now.getTime() - 31 * 86400000);

    for (const r of filtered) {
      const dStr = toISO(r.__date);
      const dObj = new Date(dStr);
      if (dObj < cutoff) continue;

      const pid = r.Plant_ID;
      const total = toKWh(r.Total_Yield, r.Yield_Unit);

      dailyByPlant[dStr] = dailyByPlant[dStr] || {};
      dailyByPlant[dStr][pid] = Math.max(dailyByPlant[dStr][pid] || 0, total);

      tableByDate[dStr] = tableByDate[dStr] || [];
      tableByDate[dStr].push({
        Plant_ID: pid,
        Plant_Name: plantMap[pid]?.Plant_Name || pid,
        Meter_Serial_No: r.Meter_Serial_No || "",
        Meter_Make: r.Meter_Make || "",
        Meter_Model: r.Meter_Model || "",
        Meter_Type: r.Meter_Type || "",
        Meter_Reading: r.Meter_Reading || "",
        Total_Yield: total,
        Date_Time: r.__date.toISOString()
      });
    }

    const dailyData = {};
    for (const d of Object.keys(dailyByPlant)) {
      dailyData[d] = Object.values(dailyByPlant[d]).reduce((a, b) => a + b, 0);
    }

    // ---- Monthly & Yearly ----
    const monthlyByPlant = {};
    const yearlyByPlant = {};

    for (const r of filtered) {
      const pid = r.Plant_ID;
      const d = toISO(r.__date);
      const monthKey = d.slice(0, 7);
      const yearKey = d.slice(0, 4);
      const inc = Number(r.Incremental_Daily_Yield_KWH) || 0;

      if (inc <= 0) continue;

      monthlyByPlant[monthKey] = monthlyByPlant[monthKey] || {};
      monthlyByPlant[monthKey][pid] = (monthlyByPlant[monthKey][pid] || 0) + inc;

      yearlyByPlant[yearKey] = yearlyByPlant[yearKey] || {};
      yearlyByPlant[yearKey][pid] = (yearlyByPlant[yearKey][pid] || 0) + inc;
    }

    // ---- Pie chart & KPI ----
    const totalByPlant = {};
    for (const r of latestReadings) {
      totalByPlant[r.Plant_ID] = (totalByPlant[r.Plant_ID] || 0) + r.Total_Yield;
    }

    const totalYield = Object.values(totalByPlant).reduce((a, b) => a + b, 0);

    let dispVal = totalYield;
    let dispUnit = "kWh";
    if (dispVal >= 1e6) {
      dispVal /= 1e6;
      dispUnit = "GWh";
    } else if (dispVal >= 1e3) {
      dispVal /= 1e3;
      dispUnit = "MWh";
    }

    const pieData = Object.entries(totalByPlant).map(([pid, val]) => ({
      Plant_ID: pid,
      Plant_Name: plantMap[pid]?.Plant_Name || pid,
      Value: val
    }));

    // ---- Final Output ----
    context.res = {
      headers: { "Content-Type": "application/json" },
      body: {
        user: email,
        plants: Object.values(plantMap),
        latestReadings,
        dailyData,
        dailyByPlant,
        tableByDate,
        history: { monthlyByPlant, yearlyByPlant },
        pieData,
        totalYield: dispVal.toFixed(3),
        yieldUnit: dispUnit,
        lastUpdated: new Date().toISOString()
      }
    };
  } catch (err) {
    context.log.error("GetMeterData ERROR:", err);
    context.res = { status: 500, body: err.message };
  }
};
