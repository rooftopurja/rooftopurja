/* nav.js */
(function () {
  var p = (location.pathname || "").toLowerCase();
  function mark(id, pages) {
    var el = document.getElementById(id);
    if (!el) return;
    if (pages.some(n => p.endsWith("/" + n) || p === "/" + n || p.endsWith(n)))
      el.classList.add("active");
  }
  mark("tab-meter", ["", "index.html", "meter.v2.html"]);
  mark("tab-ia", ["inverter_analytics.html"]);
  mark("tab-ido", ["inverter_data_overview.html"]);
  mark("tab-if", ["inverter_faults.html"]);
  mark("tab-mt", ["maintenance.html"]);
})();
