"use strict";

const crypto = require("crypto");

const AUTH_SECRET    = process.env.AUTH_SECRET_KEY;
const REFRESH_SECRET = process.env.REFRESH_SECRET_KEY;

// ----------------------------
function decodeToken(token, secret) {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;

    const check = crypto
      .createHmac("sha256", secret)
      .update(b64)
      .digest("hex");

    if (check !== sig) return null;

    const json = JSON.parse(Buffer.from(b64, "base64").toString());
    if (Date.now() > json.exp) return null;

    return json;
  } catch {
    return null;
  }
}

// ----------------------------
function createToken(payload, secret) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64");

  const sig = crypto
    .createHmac("sha256", secret)
    .update(b64)
    .digest("hex");

  return `${b64}.${sig}`;
}

// ----------------------------
module.exports = async function (context, req) {
  try {
    const refresh = req.headers["x-urja-refresh"];

    if (!refresh) {
      return (context.res = {
        status: 401,
        body: { success: false, error: "Missing refresh token" }
      });
    }

    // 1) Validate refresh token
    const decoded = decodeToken(refresh, REFRESH_SECRET);
    if (!decoded) {
      return (context.res = {
        status: 401,
        body: { success: false, error: "Invalid refresh token" }
      });
    }

    const email = decoded.email;
    const now   = Date.now();

    // 2) New 24h session
    const newSessionPayload = {
      email,
      issued: now,
      exp: now + 24 * 60 * 60 * 1000
    };
    const sessionToken = createToken(newSessionPayload, AUTH_SECRET);

    // 3) Extend refresh token (sliding 45 days)
    const newRefreshPayload = {
      email,
      issued: now,
      exp: now + 45 * 24 * 60 * 60 * 1000
    };
    const refreshToken = createToken(newRefreshPayload, REFRESH_SECRET);

    context.res = {
      status: 200,
      body: {
        success: true,
        session_token: sessionToken,
        refresh_token: refreshToken
      }
    };
  } catch (err) {
    context.log("RefreshToken ERROR:", err);
    context.res = {
      status: 500,
      body: { success: false, error: String(err) }
    };
  }
};
