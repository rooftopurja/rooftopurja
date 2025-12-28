"use strict";

const crypto = require("crypto");
const { TableClient } = require("@azure/data-tables");
const { EmailClient } = require("@azure/communication-email");

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

    /* ---------- TABLE ---------- */
    const tableClient = TableClient.fromConnectionString(
      process.env.TABLES_CONNECTION_STRING,
      TABLE
    );

    try {
      const existing = await tableClient.getEntity(email, "otp");
      if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Wait before resending OTP" }
        };
        return;
      }
    } catch (_) {}

    const otp = crypto.randomInt(100000, 999999).toString();

    await tableClient.upsertEntity({
      partitionKey: email,
      rowKey: "otp",
      otp,
      attempts: 0,
      lastSent: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    /* ---------- EMAIL (ACS) ---------- */
    const emailClient = new EmailClient(
      process.env.ACS_ENDPOINT,
      { key: process.env.ACS_KEY }
    );

    const message = {
      senderAddress: process.env.ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. It is valid for 5 minutes.`,
        html: `
          <p>Your OTP for <b>Rooftop Urja</b> is:</p>
          <h2>${otp}</h2>
          <p>This OTP is valid for 5 minutes.</p>
        `
      },
      recipients: {
        to: [{ address: email }]
      }
    };

    await emailClient.beginSend(message);

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp ERROR", err);
    context.res = { status: 500, body: { success: false } };
  }
};