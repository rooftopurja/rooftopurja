/* ======================================================
   loadUser.js — TOKEN ONLY (NO SWA)
   Rooftop Urja
   ------------------------------------------------------
   • Uses OTP-issued token stored in localStorage
   • NO /.auth/me
   • NO SWA dependency
   • Prevents auto logout
====================================================== */
(function () {
  "use strict";

  const LOGIN_PAGE = "/login.html";

  // ----------------------------------------------------
  // 1️⃣ Skip auth check on login page
  // ----------------------------------------------------
  if (location.pathname.endsWith("login.html")) {
    return;
  }

  // ----------------------------------------------------
  // 2️⃣ Token presence check
  // ----------------------------------------------------
  const token = localStorage.getItem("urja_token");

  if (!token) {
    console.warn("❌ No urja_token → redirecting to login");
    location.replace(LOGIN_PAGE);
    return;
  }

  // ----------------------------------------------------
  // 3️⃣ Optional expiry check (safe for JWT-style tokens)
  // ----------------------------------------------------
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        console.warn("❌ Token expired → redirecting to login");
        localStorage.removeItem("urja_token");
        location.replace(LOGIN_PAGE);
        return;
      }
    }
  } catch (e) {
    // token may be opaque → ignore
  }

  // ----------------------------------------------------
  // 4️⃣ Token OK → allow app to run
  // ----------------------------------------------------
  console.log("✅ Auth token present → access granted");

})();
