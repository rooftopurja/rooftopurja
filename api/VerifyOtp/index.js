"use strict";

const OTP_CACHE = require("../shared/otp_cache");
const crypto = require("crypto");

const AUTH_SECRET = process.env.AUTH_SECRET_KEY;

// ----------------------------
// Create signed token
// ----------------------------
function createToken(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64");

  const sig = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(b64)
    .digest("hex");

  return `${b64}.${sig}`;
}

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const otp = (body.otp || "").trim();

    if (!email || !otp) {
      context.res = { status: 400, body: { success: false, error: "Missing email or OTP" } };
      return;
    }

    const entry = OTP_CACHE[email];
    if (!entry || entry.otp !== otp || Date.now() > entry.expires) {
      context.res = { status: 401, body: { success: false, error: "Invalid or expired OTP" } };
      return;
    }

    delete OTP_CACHE[email];

    const token = createToken({
      email,
      issued: Date.now(),
      exp: Date.now() + 24 * 60 * 60 * 1000 // 24h
    });

    context.res = {
      status: 200,
      body: {
        success: true,
        email,
        session_token: token
      }
    };
  } catch (err) {
    context.log("VerifyOtp ERROR:", err);
    context.res = { status: 500, body: { success: false, error: "Verify failed" } };
  }
};
