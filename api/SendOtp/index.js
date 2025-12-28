"use strict";

const { TableClient } = require("@azure/data-tables");
const { EmailClient } = require("@azure/communication-email");

const TABLE_NAME = "OtpSessions";
const SENDER = process.env.ACS_EMAIL_SENDER;

const tableClient = new TableClient(
  process.env.AZURE_TABLE_ENDPOINT,
  TABLE_NAME,
  { sasToken: process.env.AZURE_TABLE_SAS }
);

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email missing" } };
      return;
    }

    const otp = generateOtp();
    const expires = Date.now() + 5 * 60 * 1000;

    await tableClient.upsertEntity({
      partitionKey: "OTP",
      rowKey: email,
      otp,
      expires
    }, "Replace");

    const emailClient = new EmailClient(
      `endpoint=${process.env.ACS_ENDPOINT};accesskey=${process.env.ACS_KEY}`
    );

    await emailClient.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        html: `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
      },
      recipients: { to: [{ address: email }] }
    });

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log.error("SendOtp error:", err);
    context.res = { status: 500, body: { success: false } };
  }
};