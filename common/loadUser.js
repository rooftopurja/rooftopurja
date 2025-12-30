/* ======================================================
   loadUser.js — SINGLE AUTHORITY FOR AUTH
   Rooftop Urja (FINAL)
====================================================== */
(function () {
  "use strict";

  const LOGIN_PAGE = "/login.html";

  // --------------------------------------------------
  // Skip auth on login page
  // --------------------------------------------------
  if (location.pathname.endsWith("login.html")) return;

  // --------------------------------------------------
  // Token check
  // --------------------------------------------------
  const token = localStorage.getItem("urja_token");

  if (!token) {
    console.warn("No token → redirect to login");
    location.replace(LOGIN_PAGE);
    return;
  }

  console.log("✅ Auth token present → access granted");

  // --------------------------------------------------
  // SWA READY DETECTION
  // --------------------------------------------------
  let attempts = 0;
  const MAX_ATTEMPTS = 40;

  function waitForSWA() {
    attempts++;

    fetch("/.auth/me", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => {
        if (!Array.isArray(j) || !j.length) throw 0;

        console.log("🔐 SWA identity ready:", j[0]?.userDetails);

        window.__SWA_READY__ = true;
        document.dispatchEvent(new Event("swa-ready"));
        wireLogout();   // 🔑 attach logout AFTER header exists
      })
      .catch(() => {
        if (attempts >= MAX_ATTEMPTS) {
          console.error("❌ SWA not ready → forcing logout");
          localStorage.removeItem("urja_token");
          location.replace(LOGIN_PAGE);
          return;
        }
        setTimeout(waitForSWA, 100);
      });
  }

  // --------------------------------------------------
  // LOGOUT HANDLER (GLOBAL)
  // --------------------------------------------------
  function wireLogout() {
    const logout = document.getElementById("logout-link");
    if (!logout) return;

    logout.onclick = (e) => {
      e.preventDefault();

      console.log("🔒 Logging out");

      localStorage.removeItem("urja_token");

      fetch("/.auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => location.replace(LOGIN_PAGE));
    };
  }

  waitForSWA();
})();
