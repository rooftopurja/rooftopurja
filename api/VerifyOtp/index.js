"use strict";

const https = require("https");

const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;
const TABLE = "OtpSessions";

const MAX_ATTEMPTS = 5;

/* ================= TABLE HELPERS ================= */
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

function tablePUT(url, entity) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(entity);
    const req = https.request(url, {
      method: "PUT",
      headers: {
        "Accept": "application/json;odata=nometadata",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => res.statusCode < 300 ? resolve() : reject());
    req.write(body);
    req.end();
  });
}

function tableDELETE(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "DELETE" }, res =>
      res.statusCode < 300 ? resolve() : reject()
    );
    req.end();
  });
}

/* ================= FUNCTION ================= */
module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: { success: false, error: "Missing email or OTP" } };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "otp";
    const url = `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`;

    const entity = await tableGET(url);

    if (Date.now() > entity.expires || entity.attempts >= MAX_ATTEMPTS) {
      await tableDELETE(url);
      context.res = { status: 401, body: { success: false, error: "OTP expired" } };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts++;
      await tablePUT(url, entity);
      context.res = { status: 401, body: { success: false, error: "Invalid OTP" } };
      return;
    }

    await tableDELETE(url);

    context.res = {
      status: 200,
      body: { success: true }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 500, body: { success: false, error: "Verify failed" } };
  }
};
