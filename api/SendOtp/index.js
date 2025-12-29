"use strict";

const https = require("https");
const { EmailClient } = require("@azure/communication-email");
const { AzureKeyCredential } = require("@azure/core-auth");

/* ========= ENV ========= */
const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;

const ACS_ENDPOINT = process.env.ACS_ENDPOINT;
const ACS_KEY = process.env.ACS_KEY;
const ACS_EMAIL_SENDER = process.env.ACS_EMAIL_SENDER;

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;

/* ========= VALIDATION ========= */
if (!TABLE_ENDPOINT || !TABLE_SAS) {
  throw new Error("Table Storage env vars missing");
}
if (!ACS_ENDPOINT || !ACS_KEY || !ACS_EMAIL_SENDER) {
  throw new Error("ACS email env vars missing");
}

/* ========= CLIENT ========= */
const emailClient = new EmailClient(
  ACS_ENDPOINT,
  new AzureKeyCredential(ACS_KEY)
);

/* ========= TABLE HELPERS ========= */
function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: "application/json;odata=nometadata" } }, res => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(buf);
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

/* ========= FUNCTION ========= */
module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").toLowerCase().trim();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    const pk = email;
    const rk = "otp";
    const url = `${TABLE_ENDPOINT}/OtpSessions(PartitionKey='${encodeURIComponent(pk)}',RowKey='${rk}')?${TABLE_SAS}`;

    const existing = await tableGET(url);
    if (existing && Date.now() - existing.created < RESEND_COOLDOWN_MS) {
      context.res = {
        status: 429,
        body: { success: false, error: "Please wait before resending OTP" }
      };
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await tablePUT(url, {
      PartitionKey: pk,
      RowKey: rk,
      otp,
      created: Date.now(),
      expires: Date.now() + OTP_TTL_MS,
      attempts: 0
    });

    await emailClient.beginSend({
      senderAddress: ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja Login OTP",
        plainText: `Your OTP is ${otp}. Valid for 5 minutes.`
      },
      recipients: {
        to: [{ address: email }]
      }
    });

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log("SendOtp ERROR:", err);
    context.res = {
      status: 500,
      body: { success: false, error: "OTP send failed" }
    };
  }
};
