"use strict";

/*
  SendOtp (SELF-CONTAINED REST)
  ----------------------------
  • Pure HTTPS + Table SAS
  • No Azure SDK
*/

const https = require("https");
const crypto = require("crypto");

/* ================= ENV ================= */
const ACCOUNT = "solariothubstorage";
const TABLE_SAS = process.env.TABLE_SAS;
const TABLE = process.env.OTP_TABLE || "OtpSessions";

const TABLE_ENDPOINT = `https://${ACCOUNT}.table.core.windows.net`;

const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const RESEND_GAP_MS = 60 * 1000;    // 60 seconds

/* ================= HELPERS ================= */

function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { "Accept": "application/json;odata=nometadata" }
    }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(body));
        resolve(JSON.parse(body || "{}"));
      });
    }).on("error", reject);
  });
}

function tablePUT(url, entity) {
  const body = JSON.stringify(entity);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
      let t = "";
      res.on("data", d => t += d);
      res.on("end", () => reject(new Error(t)));
    });
    req.write(body);
    req.end();
  });
}

/* ================= FUNCTION ================= */

module.exports = async function (context, req) {
  const email = (req.query.email || "").trim().toLowerCase();
  if (!email) {
    context.res = { status: 400, body: { success: false, error: "Email required" } };
    return;
  }

  const rowUrl =
    `${TABLE_ENDPOINT}/${TABLE}` +
    `(PartitionKey='${encodeURIComponent(email)}',RowKey='otp')?${TABLE_SAS}`;

  // Check resend gap
  try {
    const existing = await tableGET(rowUrl);
    if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
      context.res = { status: 429, body: { success: false, error: "Wait before resend" } };
      return;
    }
  } catch (_) {}

  const otp = crypto.randomInt(100000, 999999).toString();

  await tablePUT(rowUrl, {
    PartitionKey: email,
    RowKey: "otp",
    otp,
    attempts: 0,
    lastSent: Date.now(),
    expires: Date.now() + OTP_TTL_MS
  });

  // TODO: email/SMS integration (already working in your env)
  context.log(`OTP sent to ${email}: ${otp}`);

  context.res = { status: 200, body: { success: true } };
};
