// common/loadUser.js
// Responsibilities:
// 1. Session + refresh token handling
// 2. Page-level access enforcement (HARD)
// 3. Menu + UI permission enforcement
// 4. Zero flicker UX
// ❌ NO data filtering here (backend handles RLS)

(function () {
  const path = (location.pathname || "").toLowerCase();
  const page = path.split("/").pop();

  // ======================================================
  // 🔒 RESPECT EXPLICIT LOGOUT (CRITICAL)
  // ======================================================
  if (sessionStorage.getItem("urja_logged_out") === "1") {
    console.log("loadUser.js: logout flag detected, skipping auth");
    sessionStorage.removeItem("urja_logged_out");
    return;
  }

  // ======================================================
  // 🔒 SKIP LOGIN PAGE
  // ======================================================
  if (page === "login.html") {
    console.log("loadUser.js: skipped on login page");
    return;
  }

  // ======================================================
  // CONFIG
  // ======================================================
  const API_BASE = "/api";

  function hidePage() {
    const body = document.getElementById("appBody") || document.body;
    body.style.opacity = "0";
  }

  function showPage() {
    const body = document.getElementById("appBody") || document.body;
    body.style.opacity = "1";
  }

  hidePage(); // prevent flicker

  async function safeJson(resp) {
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await resp.text();
      console.warn("Non-JSON response:", text.slice(0, 120));
      throw new Error("Expected JSON");
    }
    return resp.json();
  }

  // ======================================================
  // MAIN FLOW
  // ======================================================
  async function start() {
    console.log("loadUser.js running on:", page);

    let token   = localStorage.getItem("urja_token")   || "";
    let refresh = localStorage.getItem("urja_refresh") || "";

    // --------------------------------------------------
    // 🔄 TRY REFRESH TOKEN
    // --------------------------------------------------
    if ((!token || token.length < 20) && refresh && refresh.length > 20) {
      try {
        const r = await fetch(`${API_BASE}/RefreshToken`, {
          method: "GET",
          cache: "no-store",
          headers: { "Authorization": `Bearer ${refresh}` }
        });

        if (r.ok) {
          const j = await safeJson(r);
          if (j.success) {
            localStorage.setItem("urja_token", j.session_token);
            localStorage.setItem("urja_refresh", j.refresh_token);
            token = j.session_token;
            console.log("RefreshToken OK");
          }
        }
      } catch (e) {
        console.warn("Refresh failed:", e);
      }
    }

    // --------------------------------------------------
    // ❌ NO SESSION → LOGIN
    // --------------------------------------------------
    if (!token || token.length < 20) {
      window.location.replace("login.html");
      return;
    }

    // --------------------------------------------------
    // 🔐 GET USER ACCESS (SINGLE SOURCE OF TRUTH)
    // --------------------------------------------------
    let access;
    try {
      const r = await fetch(`${API_BASE}/GetUserAccess`, {
        method: "GET",
        cache: "no-store",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!r.ok) throw new Error("GetUserAccess failed");
      access = await safeJson(r);

      if (!access.success) throw new Error(access.error);

    } catch (err) {
      console.error("Access error:", err);
      window.location.replace("login.html");
      return;
    }

    console.log("GetUserAccess OK");

    // ==================================================
    // 🔒 HARD PAGE ACCESS ENFORCEMENT
    // ==================================================
    const pageMap = {
      "meter.html": "meter",
      "inverter_analytics.html": "inverteranalytics",
      "inverter_data_overview.html": "inverterdataoverview",
      "inverter_faults.html": "inverterfaults",
      "maintenance.html": "maintenance"
    };

    const pageKey = pageMap[page];
    if (pageKey && access.pages?.[pageKey] === false) {
      console.warn("Unauthorized page:", page);
      window.location.replace("login.html");
      return;
    }

    // ==================================================
    // 🧭 MENU HIDING
    // ==================================================
    const q = s => document.querySelector(s);
    const p = access.pages || {};

    if (!p.meter)                q("#menu-meter")?.classList.add("hide");
    if (!p.inverteranalytics)    q("#menu-inverteranalytics")?.classList.add("hide");
    if (!p.inverterdataoverview) q("#menu-inverterdataoverview")?.classList.add("hide");
    if (!p.inverterfaults)       q("#menu-inverterfaults")?.classList.add("hide");
    if (!p.maintenance)          q("#menu-maintenance")?.classList.add("hide");

    // ==================================================
    // 🧠 GLOBAL CONTEXT (READ-ONLY)
    // ==================================================
    window.USER_CONTEXT = Object.freeze({
      email: access.email || "",
      role: access.role || "user",
      plant_group: access.plant_group || "all"
    });

    // ==================================================
    // 🎯 ACTIVE MENU HIGHLIGHT
    // ==================================================
    document.querySelectorAll(".navbar-menu a").forEach(a => {
      const href = (a.getAttribute("href") || "").split("/").pop().toLowerCase();
      a.classList.toggle("active", href === page);
    });

    // ==================================================
    // ✅ SHOW PAGE (NO FLICKER)
    // ==================================================
    showPage();
  }

  // ======================================================
  // HEADER ACTIONS
  // ======================================================
  document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    if (link.id === "logout-link") {
      e.preventDefault();
      sessionStorage.setItem("urja_logged_out", "1");
      localStorage.clear();
      window.location.replace("login.html");
    }

    if (link.id === "profile-link") {
      e.preventDefault();
      alert("Profile coming soon.");
    }
  });

  // BOOT
  start();
})();
