"use strict";

const https = require("https");

const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;
const TABLE = "OtpSessions";
const MAX_ATTEMPTS = 5;

function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: "application/json;odata=nometadata" } }, res => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => {
        if (res.statusCode >= 400) return reject();
        resolve(JSON.parse(buf || "{}"));
      });
    }).on("error", reject);
  });
}

function tableMERGE(url, entity) {
  const body = JSON.stringify(entity);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "MERGE",
      headers: {
        "Accept": "application/json;odata=nometadata",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "If-Match": "*"
      }
    }, res => res.statusCode < 300 ? resolve() : reject());
    req.write(body);
    req.end();
  });
}

function tableDELETE(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "DELETE",
      headers: { "If-Match": "*" }
    }, res => res.statusCode < 300 ? resolve() : reject());
    req.end();
  });
}

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "otp";

    const url =
      `${TABLE_ENDPOINT}/${TABLE}` +
      `(PartitionKey='${encodeURIComponent(pk)}',RowKey='${rk}')?${TABLE_SAS}`;

    const entity = await tableGET(url);

    if (Date.now() > entity.expires || entity.attempts >= MAX_ATTEMPTS) {
      await tableDELETE(url);
      context.res = { status: 401, body: "OTP expired" };
      return;
    }

    if (entity.otp !== otp) {
      await tableMERGE(url, { attempts: (entity.attempts || 0) + 1 });
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    await tableDELETE(url);

    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(pk)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 401, body: "Verify failed" };
  }
};
