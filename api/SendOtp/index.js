"use strict";

let EmailClient;
function getEmailClient() {
  if (!EmailClient) {
    ({ EmailClient } = require("@azure/communication-email"));
  }
  return EmailClient;
}

const OTP_CACHE = require("../shared/otp_cache");

const SENDER = process.env.ACS_EMAIL_SENDER;
const ACS_CONN = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function (context, req) {
  try {
    if (!ACS_CONN || !SENDER) {
      throw new Error("ACS Email configuration missing");
    }

    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email missing" } };
      return;
    }

    const otp = generateOtp();
    OTP_CACHE[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    const Client = getEmailClient();
    const client = new Client(ACS_CONN);

    const poller = await client.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        html: `<h2 style="letter-spacing:2px">${otp}</h2>
               <p>Valid for 5 minutes</p>`
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    await poller.pollUntilDone();

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("❌ SendOtp failed:", err);
    context.res = {
      status: 500,
      body: { success: false, error: "OTP send failed" }
    };
  }
};
