"use strict";

const https = require("https");
const { execSync } = require("child_process");

const OTP_CACHE = require("../shared/otp_cache");

const ACS_ENDPOINT = "https://urja-acs-email.communication.azure.com";
const SENDER = "DoNotReply@rooftopurja.in";

// ---------- OTP ----------
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---------- GET AAD TOKEN ----------
function getAccessToken() {
  // Works in Azure Functions (Managed Identity)
  return execSync(
    "curl -s \"http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://communication.azure.com\" -H Metadata:true"
  ).toString();
}

// ---------- SEND EMAIL ----------
function sendEmail(token, to, subject, html) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      senderAddress: SENDER,
      content: { subject, html },
      recipients: { to: [{ address: to }] }
    });

    const req = https.request(
      `${ACS_ENDPOINT}/emails:send?api-version=2023-03-31`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "Authorization": `Bearer ${token}`
        }
      },
      res => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => {
          if (res.statusCode >= 300) {
            return reject(new Error(body));
          }
          resolve();
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------- MAIN ----------
module.exports = async function (context, req) {
  try {
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

    const tokenResp = JSON.parse(getAccessToken());
    await sendEmail(
      tokenResp.access_token,
      email,
      "Your Rooftop Urja Login OTP",
      `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
    );

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("❌ SendOtp error:", err);
    context.res = { status: 500, body: { success: false, error: err.message } };
  }
};
