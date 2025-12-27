// common/loadUser.js
// Handles:
//  - Session + refresh tokens
//  - GetUserAccess
//  - Hides menu items based on permissions
//  - NO flicker / no redirects on login page
//  - Proper logout handling (no auto re-login)

(function () {
  const path = (location.pathname || "").toLowerCase();

  // 🔒 Respect explicit logout (VERY IMPORTANT)
  if (sessionStorage.getItem("urja_logged_out") === "1") {
    console.log("loadUser.js: logout flag detected, skipping auth");
    sessionStorage.removeItem("urja_logged_out");
    return;
  }

  // 🔹 Don't run anything on the login page
  if (path.endsWith("/login.html")) {
    console.log("loadUser.js: skipped on login page");
    return;
  }

  // 🔹 Functions host (for local dev use port 7071)
const API_BASE = "/api";

  async function safeJson(resp) {
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await resp.text();
      console.warn("Non-JSON response:", text.slice(0, 120));
      throw new Error("Expected JSON but got HTML");
    }
    return resp.json();
  }

  async function start() {
    console.log("loadUser.js running on:", path);

    let token   = localStorage.getItem("urja_token")   || "";
    let refresh = localStorage.getItem("urja_refresh") || "";

    // If we have no session token but we DO have refresh → try to refresh
    if ((!token || token.length < 20) && refresh && refresh.length > 20) {
      try {
        console.log("Trying RefreshToken…");
        const r = await fetch(`${API_BASE}/RefreshToken`, {
          method: "GET",
          cache: "no-store",
          headers: {
  "Authorization": `Bearer ${refresh}`
}

        });

        if (r.ok) {
          const j = await safeJson(r);
          if (j.success) {
            localStorage.setItem("urja_token",   j.session_token);
            localStorage.setItem("urja_refresh", j.refresh_token);
            token = j.session_token;
            console.log("RefreshToken OK");
          } else {
            console.warn("RefreshToken failed:", j.error);
          }
        } else {
          console.warn("RefreshToken HTTP", r.status);
        }
      } catch (err) {
        console.warn("Refresh error", err);
      }
    }

    // Still no usable token → send to login
    if (!token || token.length < 20) {
      console.warn("No valid session token → redirect to login");
      window.location.href = "login.html";
      return;
    }

    // 🔹 GetUserAccess
    try {
      const r = await fetch(`${API_BASE}/GetUserAccess`, {
        method: "GET",
        cache: "no-store",
        headers: {
  "Authorization": `Bearer ${token}`
}

      });

      if (!r.ok) {
        console.warn("GetUserAccess HTTP", r.status);
        window.location.href = "login.html";
        return;
      }

      const data = await safeJson(r);

      if (!data.success) {
        console.warn("GetUserAccess error:", data.error);
        window.location.href = "login.html";
        return;
      }

      console.log("GetUserAccess OK");
      
// ===============================
// Highlight active menu (optional)
// ===============================
const current = location.pathname.split("/").pop().toLowerCase();
document.querySelectorAll(".navbar-menu a").forEach(a => {
  const href = (a.getAttribute("href") || "")
    .split("/")
    .pop()
    .toLowerCase();
  a.classList.toggle("active", current === href);
});

      // ====== PERMISSIONS / MENU HIDING ======
      const p = data.pages || {};
      const q = (sel) => document.querySelector(sel);

      if (!p.meter)                q("#menu-meter")?.classList.add("hide");
      if (!p.inverteranalytics)    q("#menu-inverteranalytics")?.classList.add("hide");
      if (!p.inverterdataoverview) q("#menu-inverterdataoverview")?.classList.add("hide");
      if (!p.inverterfaults)       q("#menu-inverterfaults")?.classList.add("hide");
      if (!p.maintenance)          q("#menu-maintenance")?.classList.add("hide");

      // plant group for other scripts
      window.USER_PLANT_GROUP = data.plant_group || "all";

      // finally show the page (no flicker)
      const bodyEl = document.getElementById("appBody");
      if (bodyEl) {
        bodyEl.style.opacity = "1";
      } else {
        document.body.style.opacity = "1";
      }
    } catch (err) {
      console.error("loadUser.js GetUserAccess error:", err);
      window.location.replace("login.html");
    }
  }

 // ===============================
// HEADER ACTIONS (Account menu)
// ===============================
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link) return;

  // PROFILE (Option 1 – placeholder)
  if (link.id === "profile-link") {
    e.preventDefault();
    alert("Profile feature coming soon.");
    return;
  }

  // LOGOUT
  if (link.id === "logout-link") {
    e.preventDefault();

    // explicit logout marker
    sessionStorage.setItem("urja_logged_out", "1");

// clear auth
localStorage.clear();

// hard redirect (prevents token refresh race)
window.location.replace("login.html");
  }
});


  // Kick off
  start();
})();
