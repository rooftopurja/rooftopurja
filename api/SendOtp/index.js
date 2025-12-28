"use strict";

const https = require("https");
const crypto = require("crypto");

/* ================= CONFIG ================= */
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;
const TABLE = "OtpSessions";

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;

const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;

/* ================= HTTP HELPERS ================= */
function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: "application/json;odata=nometadata" } }, res => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(buf);
        resolve(JSON.parse(buf || "{}"));
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
        "Accept": "application/json;odata=nometadata",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      if (res.statusCode < 300) return resolve();
      let t = "";
      res.on("data", d => t += d);
      res.on("end", () => reject(t));
    });
    req.write(body);
    req.end();
  });
}

/* ================= FUNCTION ================= */
module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    const pk = encodeURIComponent(email);
    const rk = "otp";

    // Check resend gap
    try {
      const existing = await tableGET(
        `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`
      );
      if (Date.now() - existing.lastSent < RESEND_GAP_MS) {
        context.res = { status: 429, body: { success: false, error: "Wait before resending OTP" } };
        return;
      }
    } catch (_) {}

    const otp = crypto.randomInt(100000, 999999).toString();

    await tablePUT(
      `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`,
      {
        PartitionKey: email,
        RowKey: "otp",
        otp,
        attempts: 0,
        lastSent: Date.now(),
        expires: Date.now() + OTP_TTL_MS
      }
    );

    context.log("OTP SENT:", email, otp); // email gateway hooks here

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp ERROR", err);
    context.res = { status: 500, body: { success: false, error: "OTP error" } };
  }
};