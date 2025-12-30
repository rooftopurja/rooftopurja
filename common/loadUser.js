/* ======================================================
   loadUser.js — TOKEN ONLY (NO SWA / NO EASYAUTH)
   Rooftop Urja
====================================================== */
(function () {
  "use strict";

  const LOGIN_PAGE = "/login.html";

  // Skip auth logic on login page
  if (location.pathname.endsWith("login.html")) return;

  const token = localStorage.getItem("urja_token");

  if (!token) {
    console.warn("❌ No token → redirecting to login");
    location.replace(LOGIN_PAGE);
    return;
  }

  console.log("✅ Auth token present → access granted");

  // ---------------- LOGOUT HANDLER ----------------
  document.addEventListener("click", (e) => {
    const logout = e.target.closest("#logout-link");
    if (!logout) return;

    e.preventDefault();

    console.log("🚪 Logging out user");

    localStorage.removeItem("urja_token");
    localStorage.removeItem("urja_user");

    location.replace(LOGIN_PAGE);
  });
})();
