"use strict";

const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "OtpSessions";

const tableClient = new TableClient(
  process.env.AZURE_TABLE_ENDPOINT,
  TABLE_NAME,
  { sasToken: process.env.AZURE_TABLE_SAS }
);

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const otp = (body.otp || "").trim();

    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    let entity;
    try {
      entity = await tableClient.getEntity("OTP", email);
    } catch {
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    if (entity.otp !== otp || Date.now() > entity.expires) {
      context.res = { status: 401, body: "Invalid or expired OTP" };
      return;
    }

    // 🔥 consume OTP
    await tableClient.deleteEntity("OTP", email);

    // 🔑 hand off to SWA auth
    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(email)}`
      }
    };

  } catch (err) {
    context.log.error("VerifyOtp error:", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};
