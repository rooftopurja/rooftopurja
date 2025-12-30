/* ======================================================
   loadUser.js — SINGLE AUTHORITY FOR LOGIN + SWA READY
   Rooftop Urja
====================================================== */
(function () {
  "use strict";

  const LOGIN_PAGE = "/login.html";

  // ------------------------------------------------------------------
  // 1️⃣ Skip auth logic on login page itself
  // ------------------------------------------------------------------
  if (location.pathname.endsWith("login.html")) {
    return;
  }

  // ------------------------------------------------------------------
  // 2️⃣ Basic client-side token presence check
  //     (OTP already verified at this point)
  // ------------------------------------------------------------------
  const token = localStorage.getItem("urja_token");

  if (!token) {
    console.warn("No urja_token found → redirecting to login");
    location.replace(LOGIN_PAGE);
    return;
  }

  // ------------------------------------------------------------------
  // 3️⃣ Wait for SWA principal to be injected
  //     This is the CRITICAL FIX
  // ------------------------------------------------------------------
  let attempts = 0;
  const MAX_ATTEMPTS = 40; // ~4 seconds max

  const waitForSWA = () => {
    attempts++;

    // SWA injects this header internally and exposes it via fetch
    fetch("/.auth/me", { credentials: "same-origin" })
      .then(r => {
        if (!r.ok) throw new Error("auth not ready");
        return r.json();
      })
      .then(j => {
        if (!Array.isArray(j) || !j.length) {
          throw new Error("no identity yet");
        }

        // --------------------------------------------------------------
        // 4️⃣ AUTH READY — SIGNAL THE APP
        // --------------------------------------------------------------
        console.log("✅ SWA identity ready:", j[0]?.userDetails);

        // Global flag
        window.__SWA_READY__ = true;

        // Fire event for pages (meter, inverter analytics)
        document.dispatchEvent(new Event("swa-ready"));
      })
      .catch(() => {
        if (attempts >= MAX_ATTEMPTS) {
          console.error("❌ SWA identity not ready after timeout");
          location.replace(LOGIN_PAGE);
          return;
        }

        // Retry shortly
        setTimeout(waitForSWA, 100);
      });
  };

  waitForSWA();
})();