"use strict";

const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "OtpSessions";
const MAX_ATTEMPTS = 5;

module.exports = async function (context, req) {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email, otp } = body || {};

    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const client = TableClient.fromConnectionString(
      process.env.TABLES_CONNECTION_STRING,
      TABLE_NAME
    );

    const pk = email.toLowerCase();
    const rk = "otp";

    let entity;
    try {
      entity = await client.getEntity(pk, rk);
    } catch {
      context.res = { status: 401, body: "OTP expired or invalid" };
      return;
    }

    if (Date.now() > entity.expires || entity.attempts >= MAX_ATTEMPTS) {
      await client.deleteEntity(pk, rk);
      context.res = { status: 401, body: "OTP expired" };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts += 1;
      await client.updateEntity(entity, "Replace");
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    // SUCCESS
await tableDELETE(url);

context.res = {
  status: 302,
  headers: {
    Location: "/.auth/login/aad?post_login_redirect_uri=/"
  }
};

  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};