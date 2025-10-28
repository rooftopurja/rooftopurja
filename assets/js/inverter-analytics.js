// assets/js/inverter-analytics.js
// Final optimized browser version

(() => {
  const API_BASE =
    location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:7073"
      : "";

  const els = {
    totalYield: document.getElementById("cardYield"),
    yieldUnit: document.getElementById("cardYieldUnit"),
  };

  // --- Fetch Plant Directory ---
  async function fetchPlants() {
    try {
      const res = await fetch(`${API_BASE}/api/GetPlantDirectory`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const plants = await res.json();
      console.log("Plants:", plants);
      populatePlantDropdown(plants);
    } catch (err) {
      console.error("fetchPlants failed:", err);
    }
  }

  function populatePlantDropdown(plants) {
    const listDiv = document.getElementById("plantList");
    if (!listDiv) return;
    listDiv.innerHTML = "";
    plants.forEach((p) => {
      const row = document.createElement("div");
      row.className = "dd-row";
      row.innerHTML = `<label><input type="checkbox" data-id="${p.id}"> ${p.name}</label>`;
      listDiv.appendChild(row);
    });
  }

  // --- Fetch Analytics ---
  async function fetchAnalytics(view = "day", date = new Date().toISOString().split("T")[0], plantId = "all") {
    try {
      const res = await fetch(`${API_BASE}/api/inverter-analytics?view=${view}&date=${date}&plantId=${plantId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("Analytics:", data);
      updateCards(data.cards || {});
      renderCharts(data);
    } catch (err) {
      console.error("fetchAnalytics failed:", err);
    }
  }

  // --- Update Yield Card ---
  function updateCards(cards) {
    const yieldVal = cards.TotalYield_MWh ?? 0;
    const unit = cards.Yield_Unit || "MWh";
    if (els.totalYield) els.totalYield.textContent = yieldVal.toFixed(2);
    if (els.yieldUnit) els.yieldUnit.textContent = unit;
  }

  // --- Chart Rendering ---
  function renderCharts(data) {
    if (!window.Chart) return;

    // Hide skeletons
    const ps = document.getElementById("powerShell");
    const ys = document.getElementById("yieldShell");
    const pc = document.getElementById("powerChart");
    const yc = document.getElementById("yieldChart");
    if (ps) ps.style.display = "none";
    if (ys) ys.style.display = "none";
    if (pc) pc.style.display = "block";
    if (yc) yc.style.display = "block";

    const power = Array.isArray(data.power) ? data.power : [];
    const yieldArr = Array.isArray(data.yield) ? data.yield : [];

    const times = power.map((p) => p.time || "");
    const ac = power.map((p) => p.ac_kw || 0);
    const dc = power.map((p) => p.dc_kw || 0);

    // --- destroy safely ---
    if (window.powerChart && typeof window.powerChart.destroy === "function") {
      window.powerChart.destroy();
    }
    if (window.yieldChart && typeof window.yieldChart.destroy === "function") {
      window.yieldChart.destroy();
    }

    const ctxPwr = pc?.getContext("2d");
    const ctxYld = yc?.getContext("2d");

    if (ctxPwr) {
      window.powerChart = new Chart(ctxPwr, {
        type: "line",
        data: {
          labels: times,
          datasets: [
            { label: "AC kW", data: ac, borderColor: "#2196f3", fill: false },
            { label: "DC kW", data: dc, borderColor: "#e91e63", fill: false },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top" } },
          scales: { x: { title: { display: true, text: "Time" } }, y: { title: { display: true, text: "kW" } } },
        },
      });
    }

    if (ctxYld) {
      window.yieldChart = new Chart(ctxYld, {
        type: "bar",
        data: {
          labels: yieldArr.map((y) => y.date || y.time || ""),
          datasets: [
            {
              label: "Yield (kWh)",
              data: yieldArr.map((y) => y.kwh || 0),
              backgroundColor: "#4caf50",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { title: { display: true, text: "kWh" } } },
        },
      });
    }
  }

  // --- Dropdown and Page Init ---
  document.addEventListener("DOMContentLoaded", () => {
    console.log("Inverter Analytics initializing...");
    fetchPlants().then(() => fetchAnalytics("day"));

    const btn = document.getElementById("plantBtn");
    const menu = document.querySelector("#plant-dd .dd-menu");
    if (btn && menu) btn.onclick = () => menu.classList.toggle("open");

    const apply = document.getElementById("plantApply");
    const cancel = document.getElementById("plantCancel");
    if (apply && cancel) {
      apply.onclick = () => {
        menu.classList.remove("open");
        fetchAnalytics("day");
      };
      cancel.onclick = () => menu.classList.remove("open");
    }
  });
// fix dropdown toggle close when clicking outside
document.addEventListener("click", (e) => {
  const dd = document.getElementById("plant-dd");
  if (!dd) return;
  const menu = dd.querySelector(".dd-menu");
  if (!menu) return;
  if (!dd.contains(e.target)) menu.classList.remove("open");
});
})();