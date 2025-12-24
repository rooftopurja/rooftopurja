"use strict";

const OTP_CACHE = require("../shared/otp_cache"); // module.exports = {}
const crypto    = require("crypto");

const AUTH_SECRET    = process.env.AUTH_SECRET_KEY;
const REFRESH_SECRET = process.env.REFRESH_SECRET_KEY;

// ----------------------------
// Create Base64 Token
// ----------------------------
function createToken(payload, secret) {
  const json = JSON.stringify(payload);
  const b64  = Buffer.from(json).toString("base64");

  const sig = crypto
    .createHmac("sha256", secret)
    .update(b64)
    .digest("hex");

  return `${b64}.${sig}`;
}

// ----------------------------
// MAIN VerifyOtp function
// ----------------------------
module.exports = async function (context, req) {
  try {
    const body  = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const otp   = (body.otp   || "").trim();

    if (!email || !otp) {
      return (context.res = {
        status: 400,
        body: { success: false, error: "Missing email or OTP" }
      });
    }

    const entry = OTP_CACHE[email];

    if (!entry) {
      return (context.res = {
        status: 401,
        body: { success: false, error: "OTP expired or not generated" }
      });
    }

    if (Date.now() > entry.expires) {
      delete OTP_CACHE[email];
      return (context.res = {
        status: 401,
        body: { success: false, error: "OTP expired" }
      });
    }

    if (entry.otp !== otp) {
      return (context.res = {
        status: 401,
        body: { success: false, error: "Incorrect OTP" }
      });
    }

    // OTP OK → remove from cache
    delete OTP_CACHE[email];

    const now = Date.now();

    // Session token (24h)
    const sessionPayload = {
      email,
      issued: now,
      exp: now + 24 * 60 * 60 * 1000
    };
    const sessionToken = createToken(sessionPayload, AUTH_SECRET);

    // Refresh token (45 days)
    const refreshPayload = {
      email,
      issued: now,
      exp: now + 45 * 24 * 60 * 60 * 1000
    };
    const refreshToken = createToken(refreshPayload, REFRESH_SECRET);

    context.res = {
      status: 200,
      body: {
        success: true,
        email,
        session_token: sessionToken,
        refresh_token: refreshToken
      }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR:", err);
    context.res = {
      status: 500,
      body: { success: false, error: String(err) }
    };
  }
};
