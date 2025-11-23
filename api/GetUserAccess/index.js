"use strict";

const { TableClient } = require("@azure/data-tables");
const { getUser } = require("../shared/auth");

const conn = process.env.TABLES_CONNECTION_STRING;
const TABLE = process.env.USER_PLANT_ACCESS_TABLE || "UserPlantAccess";

module.exports = async function (context, req) {
  try {
    const userObj = getUser(req);
    const email = userObj?.email?.toLowerCase() || "";

    if (!email) {
      context.res = {
        status: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ success: false, error: "Not authenticated" })
      };
      return;
    }

    const client = TableClient.fromConnectionString(conn, TABLE);
    let record = null;

    for await (const r of client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${email}'` }
    })) {
      record = r;
      break;
    }

    if (!record) {
      context.res = {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          role: "user",
          pages: {},
          visuals: {}
        })
      };
      return;
    }

    const visuals = {
      show_power_curve: record.show_power_curve === "true",
      show_yield_trend: record.show_yield_trend === "true",
      show_kpi_yield: record.show_kpi_yield === "true",
      show_pr: record.show_pr === "true",
      show_cuf: record.show_cuf === "true"
    };

    const pages = {
      meter: record.page_meter === "true",
      inverteranalytics: record.page_inverteranalytics === "true",
      inverterdataoverview: record.page_inverterdataoverview === "true",
      inverterfaults: record.page_inverterfaults === "true",
      maintenance: record.page_maintenance === "true"
    };

    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        email,
        role: record.Role || "user",
        plant_group: record.plant_group || "all",
        visuals,
        pages
      })
    };
  } catch (err) {
    context.res = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ success: false, error: String(err) })
    };
  }
};
