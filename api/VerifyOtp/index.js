"use strict";

const { TableClient } = require("@azure/data-tables");

const table = TableClient.fromConnectionString(
  process.env.TABLES_CONNECTION_STRING,
  "OtpSessions"
);

const MAX_ATTEMPTS = 5;

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400 };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "otp";

    const entity = await table.getEntity(pk, rk);

    if (Date.now() > entity.expiresAt || entity.attempts >= MAX_ATTEMPTS) {
      await table.deleteEntity(pk, rk);
      context.res = { status: 401 };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts++;
      await table.updateEntity(entity, "Replace");
      context.res = { status: 401 };
      return;
    }

    await table.deleteEntity(pk, rk);

    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(pk)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp ERROR", err);
    context.res = { status: 401 };
  }
};
