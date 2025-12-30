"use strict";

const https = require("https");

const TABLE = "OtpSessions";
const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;

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

function tableDELETE(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "DELETE" }, res =>
      res.statusCode < 300 ? resolve() : reject()
    );
    req.end();
  });
}

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: { success: false } };
      return;
    }

    const pk = email.toLowerCase();
    const url = `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='otp')?${TABLE_SAS}`;

    const entity = await tableGET(url);

    if (Date.now() > entity.expires || entity.otp !== otp) {
      context.res = { status: 401, body: { success: false } };
      return;
    }

    await tableDELETE(url);

    const jwt = require("jsonwebtoken");

const token = jwt.sign(
  { email },
  process.env.AUTH_SECRET_KEY,
  { expiresIn: "8h" }
);

context.res = {
  status: 200,
  headers: { "Content-Type": "application/json" },
  body: { success: true }
};


  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 500, body: { success: false } };
  }
};