// header.js — loads header.v2.html + sets active menu

(async () => {
  try {
    // Load header HTML
    const r = await fetch("/common/header.v2.html");
    const html = await r.text();
    document.getElementById("header").innerHTML = html;

    // Detect current page
    const path = window.location.pathname.toLowerCase();

    const map = {
      "/meter.v2.html": "menu_meter",
      "/inverter_analytics.html": "menu_inv_analytics",
      "/inverter_overview.html": "menu_inv_overview",
      "/inverter_faults.html": "menu_inv_faults",
      "/maintenance.html": "menu_maintenance"
    };

    const activeId = map[path];
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) el.classList.add("active");
    }
  } catch (err) {
    console.error("HEADER LOAD ERROR:", err);
  }
})();
