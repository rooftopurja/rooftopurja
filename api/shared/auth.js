"use strict";

/* ------------------------------
   Read token from request
------------------------------- */
function getToken(req) {
  try {
    // 1. Check custom header
    const t1 = req.headers["x-urja-token"];
    if (t1) return t1;

    // 2. Check Authorization: Bearer xxxx
    const auth = req.headers["authorization"];
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      return auth.substring(7);
    }

    return null;
  } catch {
    return null;
  }
}

/* ------------------------------
   Decode token
------------------------------- */
function decodeToken(token) {
  try {
    const buf = Buffer.from(token, "base64");
    const json = JSON.parse(buf.toString());
    return json;   // { email, issued }
  } catch {
    return null;
  }
}

/* ------------------------------
   Validate session token
------------------------------- */
function validateSession(req) {
  const token = getToken(req);
  if (!token) return null;

  const payload = decodeToken(token);
  if (!payload) return null;

  // token age check
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  if (Date.now() - payload.issued > maxAgeMs) {
    return null;
  }

  return payload.email;
}

module.exports = { getToken, decodeToken, validateSession };
