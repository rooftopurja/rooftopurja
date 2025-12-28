"use strict";

const { TableClient } = require("@azure/data-tables");
const { EmailClient } = require("@azure/communication-email");
const crypto = require("crypto");

const TABLE = "OtpSessions";
const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const RESEND_GAP_MS = 60 * 1000;    // 60 seconds

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    // ---------- TABLE CLIENT ----------
    const tableClient = TableClient.fromConnectionString(
      process.env.TABLES_CONNECTION_STRING,
      TABLE
    );

    let existing;
    try {
      existing = await tableClient.getEntity(email, "otp");
      if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Please wait before resending OTP" }
        };
        return;
      }
    } catch (_) {
      // entity not found → OK
    }

    // ---------- OTP ----------
    const otp = crypto.randomInt(100000, 999999).toString();

    await tableClient.upsertEntity({
      partitionKey: email,
      rowKey: "otp",
      otp,
      attempts: 0,
      lastSent: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    // ---------- EMAIL (ACS) ----------
    const emailClient = new EmailClient(
      process.env.ACS_ENDPOINT,
      process.env.ACS_KEY
    );

    const message = {
      senderAddress: process.env.ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. It is valid for 5 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>.</p><p>Valid for 5 minutes.</p>`
      },
      recipients: {
        to: [{ address: email }]
      }
    };

    await emailClient.send(message);

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp FAILED:", err);
    context.res = {
      status: 500,
      body: { success: false, error: "OTP send failed" }
    };
  }
};
