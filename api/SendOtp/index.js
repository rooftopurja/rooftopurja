"use strict";

const { EmailClient } = require("@azure/communication-email");
const OTP_CACHE = require("../shared/otp_cache");

const CONNECTION_STRING =
  `endpoint=${process.env.ACS_ENDPOINT};accesskey=${process.env.ACS_KEY}`;

const SENDER = process.env.ACS_EMAIL_SENDER;

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
    OTP_CACHE[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    const client = new EmailClient(CONNECTION_STRING);

    const poller = await client.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        html: `
          <div style="font-family:Arial">
            <h2>Your OTP</h2>
            <h1>${otp}</h1>
            <p>Valid for 5 minutes</p>
          </div>`
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    await poller.pollUntilDone();

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log.error("❌ SendOtp failed:", err);
    context.res = {
      status: 500,
      body: { success: false, error: "OTP send failed" }
    };
  }
};
