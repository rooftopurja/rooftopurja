"use strict";

const { TableClient } = require("@azure/data-tables");
require("dotenv").config();

module.exports = async function GetMeterData(context, req) {
  try {
    const connStr = process.env.TABLES_CONNECTION_STRING;
    const storage = {
      directory: process.env.Plant_Directory_Table || "PlantDirectory",
      meter: process.env.METER_TABLES || "Premier300Meter",
    };

    // ---- Auth (optional) ----
    let email = "info@rooftopurja.in";
    const p = req.headers["x-ms-client-principal"];
    if (p) {
      try {
        const u = JSON.parse(Buffer.from(p, "base64").toString("utf8"));
        email = (u.userDetails || "").toLowerCase();
      } catch {}
    }

    // ---- Plant directory ----
    const dirClient = TableClient.fromConnectionString(connStr, storage.directory);
    const plantMap = {}, plantMapByMeter = {};
    for await (const e of dirClient.listEntities()) {
      plantMap[e.Plant_ID] = e;
      if (e.Meter_ID) plantMapByMeter[e.Meter_ID] = e.Plant_ID;
    }

    // ---- Read all meter rows ----
    const meterClient = TableClient.fromConnectionString(connStr, storage.meter);
    const allRows = [];
    for await (const r of meterClient.listEntities()) {

      // 🌟 DEBUG: check for bad dates
      const rawDate = r.Date_Time || r.Timestamp || r.Date;
      if (!rawDate || isNaN(new Date(rawDate).getTime())) {
        context.log("❌ BAD DATE IN METER ROW", {
          Raw: rawDate,
          Meter_ID: r.Meter_ID,
          Plant_ID: r.Plant_ID
        });
      }

      const pid = r.Plant_ID || plantMapByMeter[r.Meter_ID];
      if (!pid) continue;

      r.Plant_ID = pid;
      allRows.push(r);
    }

    context.log(`rows fetched: ${allRows.length}`);

    if (!allRows.length) {
      context.res = {
        headers: { "Content-Type": "application/json" },
        body: {
          user: email,
          dailyData: {},
          dailyByPlant: {},
          tableByDate: {},
          latestReadings: [],
          plants: [],
          pieData: [],
          history: { monthlyByPlant: {}, yearlyByPlant: {} },
          lastUpdated: new Date().toISOString(),
          totalYield: "0.000",
          yieldUnit: "kWh",
        },
      };
      return;
    }

    // ---- helpers ----
    const toISODate = (d) => new Date(d).toISOString().slice(0, 10);
    const toKWh = (val, unit) => {
      const n = Number(val) || 0;
      const u = (unit || "").toLowerCase();
      if (u.includes("gwh")) return n * 1e6;
      if (u.includes("mwh")) return n * 1e3;
      return n;
    };

    // ---- pick closest to 09:50 IST ----
    const target = 9 * 60 + 50; // 09:50
    const byMeterDate = {};
    const now = new Date();
    const cutoffStart = new Date(now.getTime() - 31 * 86400000);

    for (const r of allRows) {
      const meterId = r.Meter_ID || r.PartitionKey;
      const tsRaw = r.Date_Time || r.Timestamp || r.Date;

      if (!meterId || !tsRaw) continue;

      const dObj = new Date(tsRaw);
      if (isNaN(dObj)) continue;

      const ymd = toISODate(dObj);
      const minutes = dObj.getHours() * 60 + dObj.getMinutes();
      const diff = Math.abs(minutes - target);
      const key = `${meterId}_${ymd}`;

      if (!byMeterDate[key] || diff < byMeterDate[key].diff)
        byMeterDate[key] = { row: r, diff };
    }

    const filteredRows = Object.values(byMeterDate).map(x => x.row);

    // ---- latest per plant ----
    const latestByPlant = {};
    for (const r of filteredRows) {
      const pid = r.Plant_ID;
      const ts = new Date(r.Date_Time || r.Timestamp || r.Date);

      if (!latestByPlant[pid] || ts > new Date(latestByPlant[pid].Date_Time || 0))
        latestByPlant[pid] = r;
    }

    const latestReadings = Object.values(latestByPlant).map(r => ({
      Plant_ID: r.Plant_ID,
      Plant_Name: plantMap[r.Plant_ID]?.Plant_Name || r.Plant_ID,
      Meter_ID: r.Meter_ID || "",
      Meter_Serial_No: r.Meter_Serial_No || "",
      Meter_Make: r.Meter_Make || "",
      Meter_Model: r.Meter_Model || "",
      Meter_Type: r.Meter_Type || "",
      Meter_Reading: r.Meter_Reading || "",
      Total_Yield: toKWh(r.Total_Yield, r.Yield_Unit),
      Yield_Unit: "kWh",
      Incremental_Daily_Yield_KWH: Number(r.Incremental_Daily_Yield_KWH) || 0,
      Date_Time: r.Date_Time || "",
    }));

    // ---- daily & table ----
    const dailyByPlant = {};
    const tableByDate = {};

    for (const r of filteredRows) {
      const dateKey = toISODate(r.Date_Time || r.Timestamp || r.Date);
      const ts = new Date(dateKey);
      if (ts < cutoffStart) continue;

      const pid = r.Plant_ID;
      const totalKWh = toKWh(r.Total_Yield, r.Yield_Unit);

      dailyByPlant[dateKey] = dailyByPlant[dateKey] || {};
      dailyByPlant[dateKey][pid] = Math.max(dailyByPlant[dateKey][pid] || 0, totalKWh);

      tableByDate[dateKey] = tableByDate[dateKey] || [];
      tableByDate[dateKey].push({
        Plant_ID: pid,
        Plant_Name: plantMap[pid]?.Plant_Name || pid,
        Meter_Serial_No: r.Meter_Serial_No || "",
        Meter_Make: r.Meter_Make || "",
        Meter_Model: r.Meter_Model || "",
        Meter_Type: r.Meter_Type || "",
        Meter_Reading: r.Meter_Reading || "",
        Total_Yield: totalKWh,
        Date_Time: r.Date_Time || ""
      });
    }

    const dailyData = {};
    for (const d of Object.keys(dailyByPlant)) {
      dailyData[d] = Object.values(dailyByPlant[d]).reduce((a, b) => a + b, 0);
    }

    // ---- month & year ----
    const monthlyByPlant = {};
    const yearlyByPlant = {};
    const totalsOnDateByPlant = {};

    for (const r of filteredRows) {
      const pid = r.Plant_ID;
      const d = toISODate(r.Date_Time || r.Timestamp || r.Date);
      const monthKey = d.slice(0, 7);
      const yearKey = d.slice(0, 4);
      const tot = toKWh(r.Total_Yield, r.Yield_Unit);
      const inc = Number(r.Incremental_Daily_Yield_KWH) || 0;

      totalsOnDateByPlant[pid] = totalsOnDateByPlant[pid] || {};
      totalsOnDateByPlant[pid][d] = Math.max(totalsOnDateByPlant[pid][d] || 0, tot);

      monthlyByPlant[monthKey] = monthlyByPlant[monthKey] || {};
      yearlyByPlant[yearKey] = yearlyByPlant[yearKey] || {};

      if (inc > 0) {
        monthlyByPlant[monthKey][pid] = (monthlyByPlant[monthKey][pid] || 0) + inc;
        yearlyByPlant[yearKey][pid] = (yearlyByPlant[yearKey][pid] || 0) + inc;
      }
    }

    // ---- fill missing increments using deltas ----
    for (const pid of Object.keys(totalsOnDateByPlant)) {
      const days = Object.keys(totalsOnDateByPlant[pid]).sort();
      let prev = null;

      for (const d of days) {
        const m = d.slice(0, 7);
        const y = d.slice(0, 4);
        const t = totalsOnDateByPlant[pid][d];

        if (prev != null && t > prev) {
          monthlyByPlant[m] = monthlyByPlant[m] || {};
          yearlyByPlant[y] = yearlyByPlant[y] || {};
          monthlyByPlant[m][pid] = (monthlyByPlant[m][pid] || 0) + (t - prev);
          yearlyByPlant[y][pid] = (yearlyByPlant[y][pid] || 0) + (t - prev);
        }

        prev = t;
      }
    }

    // ---- KPI & Pie ----
    const totalByPlant = {};
    for (const r of latestReadings) {
      totalByPlant[r.Plant_ID] = (totalByPlant[r.Plant_ID] || 0) + r.Total_Yield;
    }

    let totalYieldKWh = Object.values(totalByPlant).reduce((a, b) => a + b, 0);
    let displayValue = totalYieldKWh;
    let displayUnit = "kWh";

    if (displayValue >= 1e6) {
      displayValue /= 1e6;
      displayUnit = "GWh";
    } else if (displayValue >= 1e3) {
      displayValue /= 1e3;
      displayUnit = "MWh";
    }

    const pieData = Object.entries(totalByPlant).map(([id, val]) => ({
      Plant_ID: id,
      Plant_Name: plantMap[id]?.Plant_Name || id,
      Value: val
    }));

    context.res = {
      headers: { "Content-Type": "application/json" },
      body: {
        user: email,
        plants: Object.values(plantMap || {}),
        latestReadings,
        dailyData,
        dailyByPlant,
        tableByDate,
        history: { monthlyByPlant, yearlyByPlant },
        pieData,
        totalYield: displayValue.toFixed(3),
        yieldUnit: displayUnit,
        lastUpdated: new Date().toISOString()
      }
    };

  } catch (err) {
    context.log.error("GetMeterData error:", err);
    context.res = { status: 500, body: err.message || "Server Error" };
  }
};
