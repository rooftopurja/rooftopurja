"use strict";

const { EmailClient } = require("@azure/communication-email");
const OTP_CACHE = require("../shared/otp_cache");

const SENDER = process.env.ACS_EMAIL_SENDER;

function getConnectionString() {
  const endpoint = process.env.ACS_ENDPOINT;
  const key = process.env.ACS_KEY;
  if (!endpoint || !key) throw new Error("Missing ACS_ENDPOINT or ACS_KEY");
  return `endpoint=${endpoint};accesskey=${key}`;
}

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

    if (!SENDER) throw new Error("Missing ACS_EMAIL_SENDER");

    // 1️⃣ Generate + store OTP
    const otp = generateOtp();
    OTP_CACHE[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    const client = new EmailClient(getConnectionString());

    // 2️⃣ SEND EMAIL (WAIT FOR COMPLETION)
    const poller = await client.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. It is valid for 5 minutes.`,
        html: `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    await poller.pollUntilDone(); // 🔑 CRITICAL FIX

    context.res = {
      status: 200,
      body: { success: true }
    };

  } catch (err) {
    context.log.error("SendOtp ERROR:", err);
    context.res = {
  status: 500,
  body: {
    success: false,
    error: err.message,
    stack: err.stack
  }
};

  }
};
