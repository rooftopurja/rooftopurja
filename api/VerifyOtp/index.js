"use strict";

const https = require("https");

const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;
const TABLE = "OtpSessions";

const MAX_ATTEMPTS = 5;

/* ---------- HELPERS ---------- */

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { Accept: "application/json;odata=nometadata" } },
      res => {
        let buf = "";
        res.on("data", d => (buf += d));
        res.on("end", () => {
          if (res.statusCode === 404) return resolve(null);
          if (res.statusCode >= 400)
            return reject(new Error(`GET ${res.statusCode}`));
          resolve(JSON.parse(buf || "{}"));
        });
      }
    ).on("error", reject);
  });
}

function tablePUT(url, entity) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(entity);
    const req = https.request(
      url,
      {
        method: "PUT",
        headers: {
          Accept: "application/json;odata=nometadata",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "If-Match": "*"
        }
      },
      res => (res.statusCode < 300 ? resolve() : reject())
    );
    req.write(body);
    req.end();
  });
}

function tableDELETE(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "DELETE",
        headers: { "If-Match": "*" }
      },
      res => (res.statusCode < 300 ? resolve() : reject())
    );
    req.end();
  });
}

/* ---------- FUNCTION ---------- */

module.exports = async function (context, req) {
  try {
    const { email, otp } = parseBody(req);

    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const pk = encodeURIComponent(email.toLowerCase());
    const rk = "otp";

    const url = `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`;

    const entity = await tableGET(url);

    if (!entity) {
      context.res = { status: 401, body: "OTP expired or invalid" };
      return;
    }

    if (Date.now() > entity.expires || entity.attempts >= MAX_ATTEMPTS) {
      await tableDELETE(url);
      context.res = { status: 401, body: "OTP expired" };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts++;
      await tablePUT(url, entity);
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    // ✅ SUCCESS
    await tableDELETE(url);

    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(email)}`
      }
    };
  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};
