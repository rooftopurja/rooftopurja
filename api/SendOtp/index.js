"use strict";

const { EmailClient } = require("@azure/communication-email");
const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

const emailClient = new EmailClient(process.env.ACS_ENDPOINT, {
  key: process.env.ACS_KEY
});

const table = TableClient.fromConnectionString(
  process.env.TABLES_CONNECTION_STRING,
  "OtpSessions"
);

const OTP_TTL_MS = 5 * 60 * 1000; // 5 mins
const RESEND_COOLDOWN_MS = 60 * 1000;

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false } };
      return;
    }

    const pk = email;
    const rk = "otp";

    // check existing OTP
    try {
      const existing = await table.getEntity(pk, rk);
      if (Date.now() - existing.createdAt < RESEND_COOLDOWN_MS) {
        context.res = {
          status: 429,
          body: { success: false, error: "Please wait before resending OTP" }
        };
        return;
      }
    } catch (_) {}

    const otp = crypto.randomInt(100000, 999999).toString();

    await table.upsertEntity({
      partitionKey: pk,
      rowKey: rk,
      otp,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_TTL_MS
    });

    await emailClient.send({
      senderAddress: process.env.ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. Valid for 5 minutes.`
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp ERROR", err);
    context.res = { status: 500, body: { success: false } };
  }
};
