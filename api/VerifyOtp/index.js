"use strict";

const OTP_CACHE = require("../shared/otp_cache");

module.exports = async function (context, req) {
  try {
    const body  = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const otp   = (body.otp || "").trim();

    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const entry = OTP_CACHE[email];

    if (!entry || entry.otp !== otp || Date.now() > entry.expires) {
      context.res = { status: 401, body: "Invalid or expired OTP" };
      return;
    }

    // ✅ consume OTP
    delete OTP_CACHE[email];

    // ✅ HAND OFF TO SWA AUTH (THIS IS THE KEY)
    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(email)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR:", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};