"use strict";

// LOCAL DEV VERSION (no table lookup)
module.exports = async function (context, req) {
  try {
    const token = req.headers["x-urja-token"] || "";
    let email = "";

    // decode token if exists
    if (token) {
      try {
        const decoded = JSON.parse(Buffer.from(token, "base64").toString());
        email = decoded.email || "";
      } catch {}
    }

    if (!email) email = "localuser@example.com";

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success: true,
        email,
        role: "admin",
        plant_group: "all",

        pages: {
          meter: true,
          inverteranalytics: true,
          inverterdataoverview: true,
          inverterfaults: true,
          maintenance: true
        },

        visuals: {
          show_power_curve: true,
          show_yield_trend: true,
          show_kpi_yield: true,
          show_pr: true,
          show_cuf: true
        }
      }
    };

  } catch (err) {
    context.log("GetUserAccess ERROR:", err);
    context.res = {
      status: 500,
      body: { success: false, error: String(err) }
    };
  }
};
