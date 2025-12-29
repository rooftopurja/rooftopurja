"use strict";

const https = require("https");
const { EmailClient } = require("@azure/communication-email");

const TABLE_ENDPOINT = process.env.TABLE_STORAGE_URL;
const TABLE_SAS = process.env.TABLE_STORAGE_SAS;
const TABLE = "OtpSessions";

const ACS_ENDPOINT = process.env.ACS_ENDPOINT;
const ACS_KEY = process.env.ACS_KEY;
const ACS_EMAIL_SENDER = process.env.ACS_EMAIL_SENDER;

const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const COOLDOWN_MS = 60 * 1000;     // 60 seconds

/* ================= TABLE HELPERS ================= */
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

/* ================= FUNCTION ================= */
module.exports = async function (context, req) {
  try {
    const email = (req.query.email || "").toLowerCase();
    if (!email) {
      context.res = { status: 400, body: { success: false, error: "Email required" } };
      return;
    }

    const pk = email;
    const rk = "otp";
    const url = `${TABLE_ENDPOINT}/${TABLE}(PartitionKey='${pk}',RowKey='${rk}')?${TABLE_SAS}`;

    const existing = await tableGET(url);
    const now = Date.now();

    if (existing?.lastSent && (now - existing.lastSent) < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - existing.lastSent)) / 1000);
      context.res = {
        status: 429,
        body: { success: false, error: `Please wait ${wait}s before resending OTP` }
      };
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const entity = {
      PartitionKey: pk,
      RowKey: rk,
      otp,
      attempts: 0,
      expires: now + OTP_TTL_MS,
      lastSent: now
    };

    await tablePUT(url, entity);

    const emailClient = new EmailClient(ACS_ENDPOINT, { key: ACS_KEY });

    await emailClient.send({
      senderAddress: ACS_EMAIL_SENDER,
      content: {
        subject: "Your Rooftop Urja OTP",
        plainText: `Your OTP is ${otp}. Valid for 5 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>. Valid for 5 minutes.</p>`
      },
      recipients: { to: [{ address: email }] }
    });

    context.res = {
      status: 200,
      body: { success: true, cooldownSeconds: 60 }
    };

  } catch (err) {
    context.log("SendOtp ERROR", err);
    context.res = { status: 500, body: { success: false, error: "OTP send failed" } };
  }
};
