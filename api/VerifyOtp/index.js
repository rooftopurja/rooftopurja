"use strict";

/*
   VerifyOtp (SELF-CONTAINED, REST ONLY)
   ------------------------------------
   • No Azure SDK
   • HTTPS + Table SAS
   • Enforces UserPlantAccess
   • Issues SWA custom login redirect
*/

const https = require("https");

/* ================= ENV ================= */
const ACCOUNT = "solariothubstorage";
const TABLE_SAS = process.env.TABLE_SAS;   // NO leading "?"
const TABLE_ENDPOINT = `https://${ACCOUNT}.table.core.windows.net`;

const OTP_TABLE = "OtpSessions";
const USER_ACCESS_TABLE = "UserPlantAccess";

const MAX_ATTEMPTS = 5;

/* ================= LOW LEVEL GET ================= */
function tableGET(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers: { Accept: "application/json;odata=nometadata" } },
      res => {
        let body = "";
        res.on("data", d => (body += d));
        res.on("end", () => {
          if (res.statusCode >= 400) return reject();
          try {
            resolve(JSON.parse(body || "{}"));
          } catch {
            reject();
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/* ================= LOW LEVEL MERGE ================= */
function tableMERGE(url, entity) {
  const body = JSON.stringify(entity);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "MERGE",
        headers: {
          Accept: "application/json;odata=nometadata",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "If-Match": "*"
        }
      },
      res => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        reject();
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ================= LOW LEVEL DELETE ================= */
function tableDELETE(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json;odata=nometadata",
          "If-Match": "*"
        }
      },
      res => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        reject();
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/* ================= MAIN ================= */
module.exports = async function (context, req) {
  try {
    if (!TABLE_SAS) {
      context.res = { status: 500, body: "TABLE_SAS missing" };
      return;
    }

    const { email, otp } = req.body || {};
    const key = String(email || "").trim().toLowerCase();

    if (!key || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    /* ---------- LOAD OTP ---------- */
    const otpUrl =
      `${TABLE_ENDPOINT}/${OTP_TABLE}` +
      `(PartitionKey='${encodeURIComponent(key)}',RowKey='otp')?${TABLE_SAS}`;

    let entity;
    try {
      entity = await tableGET(otpUrl);
    } catch {
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    if (Date.now() > entity.expires) {
      await tableDELETE(otpUrl);
      context.res = { status: 401, body: "OTP expired" };
      return;
    }

    if (entity.attempts >= MAX_ATTEMPTS) {
      await tableDELETE(otpUrl);
      context.res = { status: 401, body: "Too many attempts" };
      return;
    }

    if (String(entity.otp) !== String(otp)) {
      entity.attempts = (entity.attempts || 0) + 1;
      await tableMERGE(otpUrl, { attempts: entity.attempts });
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    /* ---------- USER ACCESS CHECK ---------- */
    const accessUrl =
      `${TABLE_ENDPOINT}/${USER_ACCESS_TABLE}` +
      `(PartitionKey='${encodeURIComponent(key)}',RowKey='profile')?${TABLE_SAS}`;

    let access;
    try {
      access = await tableGET(accessUrl);
    } catch {
      context.res = { status: 403, body: "Access not granted" };
      return;
    }

    if (access.Enabled !== true) {
      context.res = { status: 403, body: "Access disabled" };
      return;
    }

    /* ---------- SUCCESS ---------- */
    await tableDELETE(otpUrl);

    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(key)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp fatal", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};
