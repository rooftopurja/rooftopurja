"use strict";

const { TableClient } = require("@azure/data-tables");
const { EmailClient } = require("@azure/communication-email");

const TABLE = "OtpSessions";
const CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const SENDER = process.env.ACS_EMAIL_SENDER;

const table = TableClient.fromConnectionString(CONN, TABLE);

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false } };
      return;
    }

    const otp = generateOtp();

    // 🔐 Store OTP in Table (single source of truth)
    await table.upsertEntity({
      partitionKey: email,
      rowKey: "OTP",
      otp,
      expires: Date.now() + 5 * 60 * 1000
    });

    // ✉️ Send email
    const client = new EmailClient(
      `endpoint=${process.env.ACS_ENDPOINT};accesskey=${process.env.ACS_KEY}`
    );

    await client.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `${otp}\n\nValid for 5 minutes`
      },
      recipients: { to: [{ address: email }] }
    });

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log.error("SendOtp ERROR:", err);
    context.res = { status: 500, body: { success: false } };
  }
};
