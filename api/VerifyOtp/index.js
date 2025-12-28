"use strict";

const OTP_CACHE = require("../shared/otp_cache");

module.exports = async function (context, req) {
  try {
    const body  = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const otp   = (body.otp || "").trim();

    if (!email || !otp) {
      context.res = { status: 400, body: { success: false, error: "Missing email or OTP" } };
      return;
    }

    const entry = OTP_CACHE[email];

    if (!entry) {
      context.res = { status: 401, body: { success: false, error: "OTP expired" } };
      return;
    }

    if (entry.otp !== otp) {
      context.res = { status: 401, body: { success: false, error: "Invalid OTP" } };
      return;
    }

    if (Date.now() > entry.expires) {
      delete OTP_CACHE[email];
      context.res = { status: 401, body: { success: false, error: "OTP expired" } };
      return;
    }

    // ✅ consume OTP
    delete OTP_CACHE[email];

    // ✅ HAND OVER TO AZURE STATIC WEB APPS AUTH
    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(email)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR:", err);
    context.res = { status: 500, body: { success: false, error: "Verify failed" } };
  }
};
