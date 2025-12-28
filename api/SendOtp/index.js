"use strict";

const crypto = require("crypto");
const { EmailClient } = require("@azure/communication-email");

const TABLE = "OtpSessions";
const OTP_TTL_MS = 5 * 60 * 1000;   // 5 min
const RESEND_GAP_MS = 60 * 1000;    // 60 sec

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    // ---- ENV CHECK (fail fast)
    const ACS_ENDPOINT = process.env.ACS_ENDPOINT;
    const ACS_KEY = process.env.ACS_KEY;
    const ACS_EMAIL_SENDER = process.env.ACS_EMAIL_SENDER;
    const TABLE_CONN = process.env.TABLES_CONNECTION_STRING;

    if (!ACS_ENDPOINT || !ACS_KEY || !ACS_EMAIL_SENDER || !TABLE_CONN) {
      context.log("❌ Missing environment variables");
      context.res = { status: 500, body: { success: false, error: "Server misconfigured" } };
      return;
    }

    const { TableClient } = require("@azure/data-tables");
    const table = TableClient.fromConnectionString(TABLE_CONN, TABLE);

    // ---- RATE LIMIT CHECK
    let existing;
    try {
      existing = await table.getEntity(email, "otp");
      if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Please wait before resending OTP" }
        };
        return;
      }
    } catch (_) {}

    // ---- GENERATE OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    await table.upsertEntity({
      partitionKey: email,
      rowKey: "otp",
      otp,
      attempts: 0,
      lastSent: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    // ---- SEND EMAIL (ACS)
    const emailClient = new EmailClient(ACS_ENDPOINT, { key: ACS_KEY });

    await emailClient.send({
      senderAddress: ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. It is valid for 5 minutes.`,
        html: `
          <div style="font-family:Segoe UI,sans-serif">
            <h3>Rooftop Urja Login OTP</h3>
            <p>Your OTP is:</p>
            <h2>${otp}</h2>
            <p>This OTP is valid for 5 minutes.</p>
          </div>
        `
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    context.log("✅ OTP email sent to", email);

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("❌ SendOtp error:", err);
    context.res = { status: 500, body: { success: false, error: "OTP send failed" } };
  }
};
