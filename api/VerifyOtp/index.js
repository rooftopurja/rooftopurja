"use strict";

const { TableClient } = require("@azure/data-tables");

const TABLE = "OtpSessions";
const CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;

const table = TableClient.fromConnectionString(CONN, TABLE);

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400 };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "OTP";

    const entity = await table.getEntity(pk, rk);

    if (entity.otp !== otp || Date.now() > entity.expires) {
      context.res = { status: 401 };
      return;
    }

    // ✅ Consume OTP
    await table.deleteEntity(pk, rk);

    // ✅ CORRECT SWA AUTH HANDOFF
    context.res = {
      status: 302,
      headers: {
        Location:
          "/.auth/login/custom" +
          "?provider=custom" +
          `&userId=${encodeURIComponent(pk)}` +
          `&userDetails=${encodeURIComponent(pk)}` +
          "&roles=authenticated"
      }
    };

  } catch (err) {
    context.log.error("VerifyOtp ERROR:", err);
    context.res = { status: 401 };
  }
};
