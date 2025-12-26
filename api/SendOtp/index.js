"use strict";

/**
 * Lazy-load EmailClient to avoid SWA cold-start crashes
 */
let EmailClient;
function getEmailClient() {
  if (!EmailClient) {
    ({ EmailClient } = require("@azure/communication-email"));
  }
  return EmailClient;
}

const OTP_CACHE = require("../shared/otp_cache");

/**
 * Build ACS connection string at runtime
 */
function getAcsConnectionString() {
  const endpoint = process.env.ACS_ENDPOINT;
  const key = process.env.ACS_KEY;

  if (!endpoint || !key) {
    throw new Error("ACS_ENDPOINT or ACS_KEY missing");
  }

  return `endpoint=${endpoint};accesskey=${key}`;
}

const SENDER = process.env.ACS_EMAIL_SENDER;

/**
 * Generate 6-digit OTP
 */
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function (context, req) {
  try {
    context.log("📧 SendOtp invoked");

    if (!SENDER) {
      throw new Error("ACS_EMAIL_SENDER missing");
    }

    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = {
        status: 400,
        body: { success: false, error: "Email missing" }
      };
      return;
    }

    // Generate OTP
    const otp = generateOtp();

    // Cache OTP (5 min)
    OTP_CACHE[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    // Init client (lazy)
    const Client = getEmailClient();
    const client = new Client(getAcsConnectionString());

    context.log("📤 Sending OTP email to", email);

    // Send email
    const poller = await client.beginSend({
      senderAddress: SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        html: `
          <div style="font-family:Arial,sans-serif">
            <h2 style="letter-spacing:2px">${otp}</h2>
            <p>This OTP is valid for <b>5 minutes</b>.</p>
            <p>If you did not request this, please ignore.</p>
          </div>
        `
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    await poller.pollUntilDone();

    context.log("✅ OTP email sent successfully");

    context.res = {
      status: 200,
      body: { success: true }
    };

  } catch (err) {
    context.log.error("❌ SendOtp failed:", err);

    context.res = {
      status: 500,
      body: {
        success: false,
        error: "Failed to send OTP"
      }
    };
  }
};
