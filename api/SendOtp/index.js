"use strict";

const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

const TABLE = "OtpSessions";
const OTP_TTL_MS = 5 * 60 * 1000;     // 5 min
const RESEND_GAP_MS = 60 * 1000;      // 60 sec

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    const client = TableClient.fromConnectionString(
      process.env.AzureWebJobsStorage,
      TABLE
    );

    let entity;
    try {
      entity = await client.getEntity(email, "otp");
      if (Date.now() - entity.lastSent < RESEND_GAP_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Wait before resending OTP" }
        };
        return;
      }
    } catch (_) {}

    const otp = crypto.randomInt(100000, 999999).toString();

    await client.upsertEntity({
      partitionKey: email,
      rowKey: "otp",
      otp,
      attempts: 0,
      lastSent: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    // 🔔 SEND EMAIL (already working in your env)
    context.log("OTP sent:", email, otp);

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp error", err);
    context.res = { status: 500, body: { success: false } };
  }
};
