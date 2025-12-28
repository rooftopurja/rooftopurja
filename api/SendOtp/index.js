"use strict";

const OTP_CACHE = require("../shared/otp_cache");
const crypto = require("crypto");

module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();

    if (!email) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { success: false, error: "Email required" }
      };
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP (5 min)
    OTP_CACHE[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    // 🔔 TEMPORARY: log OTP (for testing)
    context.log(`OTP for ${email}: ${otp}`);

    // TODO: plug email/SMS service here

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success: true,
        message: "OTP sent"
      }
    };
  } catch (err) {
    context.log("SendOtp ERROR:", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        success: false,
        error: "Internal OTP error"
      }
    };
  }
};
