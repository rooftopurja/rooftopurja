"use strict";

const { TableClient } = require("@azure/data-tables");

const TABLE = "OtpSessions";
const MAX_ATTEMPTS = 5;

module.exports = async function (context, req) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      context.res = { status: 400, body: "Missing email or OTP" };
      return;
    }

    const client = TableClient.fromConnectionString(
      process.env.AzureWebJobsStorage,
      TABLE
    );

    let entity;
    try {
      entity = await client.getEntity(email.toLowerCase(), "otp");
    } catch {
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    if (Date.now() > entity.expires) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
      context.res = { status: 401, body: "OTP expired" };
      return;
    }

    if (entity.attempts >= MAX_ATTEMPTS) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
      context.res = { status: 401, body: "Too many attempts" };
      return;
    }

    if (entity.otp !== otp) {
      entity.attempts += 1;
      await client.updateEntity(entity, "Merge");
      context.res = { status: 401, body: "Invalid OTP" };
      return;
    }

    // ✅ SUCCESS
    await client.deleteEntity(entity.partitionKey, entity.rowKey);

    context.res = {
      status: 302,
      headers: {
        Location: `/.auth/login/custom?email=${encodeURIComponent(email)}`
      }
    };

  } catch (err) {
    context.log("VerifyOtp error", err);
    context.res = { status: 500, body: "Verify failed" };
  }
};
