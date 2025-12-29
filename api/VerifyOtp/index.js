"use strict";

const { TableClient } = require("@azure/data-tables");

const tableClient = new TableClient(
  process.env.TABLE_STORAGE_URL,
  "OtpSessions",
  { credential: process.env.TABLE_STORAGE_SAS }
);

const MAX_ATTEMPTS = 5;

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: { success: false } };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "otp";

    const entity = await tableClient.getEntity(pk, rk);

    if (Date.now() > entity.expires || entity.attempts >= MAX_ATTEMPTS) {
      await tableClient.deleteEntity(pk, rk);
      context.res = { status: 401, body: { success: false } };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts++;
      await tableClient.updateEntity(entity, "Replace");
      context.res = { status: 401, body: { success: false } };
      return;
    }

    // OTP valid
    await tableClient.deleteEntity(pk, rk);

    // set auth cookie
    context.res = {
      status: 200,
      headers: {
        "Set-Cookie": `ru_auth=${Buffer.from(email).toString("base64")}; Path=/; HttpOnly; Secure; SameSite=Lax`
      },
      body: { success: true }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 500, body: { success: false } };
  }
};
