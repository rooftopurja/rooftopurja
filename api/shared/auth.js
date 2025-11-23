"use strict";

/**
 * Extract authenticated user info from SWA headers.
 * Works for both:
 *   - x-ms-client-principal (base64 JSON)
 *   - x-ms-client-principal-email
 */

function getUser(req) {
  try {
    // Direct email header (SWA standard)
    const email = req.headers["x-ms-client-principal-email"];
    if (email) {
      return { email: email.toLowerCase().trim() };
    }

    // Encoded principal (fallback)
    const encoded = req.headers["x-ms-client-principal"];
    if (!encoded) return null;

    const json = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    );

    return {
      email: (json.userDetails || "").toLowerCase().trim(),
      userId: json.userId || "",
      identityProvider: json.identityProvider || ""
    };
  } catch (err) {
    return null;
  }
}

module.exports = { getUser };