"use strict";

const crypto = require("crypto");
const { EmailClient } = require("@azure/communication-email");
const { TableClient } = require("@azure/data-tables");

const TABLE = "OtpSessions";
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    const TABLE_CONN = process.env.TABLES_CONNECTION_STRING;
    const ACS_CONN = process.env.ACS_EMAIL_CONNECTION_STRING;
    const SENDER = process.env.ACS_EMAIL_SENDER;

    if (!TABLE_CONN || !ACS_CONN || !SENDER) {
      context.log("❌ Missing env vars", {
        TABLE_CONN: !!TABLE_CONN,
        ACS_CONN: !!ACS_CONN,
        SENDER: !!SENDER
      });
      context.res = { status: 500, body: { success: false, error: "Server misconfigured" } };
      return;
    }

    // ---- TABLE
    const table = TableClient.fromConnectionString(TABLE_CONN, TABLE);

    try {
      const existing = await table.getEntity(email, "otp");
      if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Please wait before resending OTP" }
        };
        return;
      }
    } catch (_) {}

    const otp = crypto.randomInt(100000, 999999).toString();

    await table.upsertEntity({
      partitionKey: email,
      rowKey: "otp",
      otp,
      attempts: 0,
      lastSent: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    // ---- EMAIL (THIS IS THE FIX)
    const emailClient = new EmailClient(ACS_CONN);

    const poller = await emailClient.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. It is valid for 5 minutes.`,
        html: `
          <div style="font-family:Segoe UI,sans-serif">
            <h3>Rooftop Urja Login OTP</h3>
            <p>Your OTP is:</p>
            <h2>${otp}</h2>
            <p>Valid for 5 minutes.</p>
          </div>
        `
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    await poller.pollUntilDone();

    context.log("✅ OTP email SENT", email);

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("❌ SendOtp REAL ERROR:", err);
    context.res = { status: 500, body: { success: false, error: "OTP send failed" } };
  }
};
