"use strict";

const { TableClient } = require("@azure/data-tables");

const TABLE = "OtpSessions";
const CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;

const table = TableClient.fromConnectionString(CONN, TABLE);

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const pk = email.toLowerCase();
    const rk = "OTP";

    // 🔍 Read OTP from Table
    const entity = await table.getEntity(pk, rk);

    if (
      entity.otp !== otp ||
      Date.now() > entity.expires
    ) {
      context.res = { status: 401, body: "Invalid or expired OTP" };
      return;
    }

    // ✅ Delete OTP (single-use)
    await table.deleteEntity(pk, rk);

    // 🔐 HANDOVER TO SWA AUTH (CORRECT WAY)
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
    context.res = { status: 500, body: "Verify failed" };
  }
};
