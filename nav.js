// Update hrefs if your filenames differ.
const LINKS = [
  { href: "/",                         label: "Dashboard" },
  { href: "/meter.v2.html",            label: "Meter" },
  { href: "/inverter_analytics.html",  label: "Inverter Analytics" },
  { href: "/inverter_overview.html",   label: "Inverter Data Overview" },
  { href: "/inverter_faults.html",     label: "Inverter Faults" }
];

(function(){
  const placeholder = document.getElementById("global-nav");
  if(!placeholder) return;
  const path = location.pathname.toLowerCase();
  const bar = document.createElement("div");
  bar.className = "navbar";
  bar.innerHTML = `
    <div class="navwrap">
      <div class="brand">Solar Plant Dashboard</div>
      <div class="navspacer"></div>
      ${LINKS.map(l => {
        const active = path === l.href.toLowerCase();
        return `<a class="navlink ${active ? "active" : ""}" href="${l.href}">${l.label}</a>`;
      }).join("")}
    </div>`;
  placeholder.replaceWith(bar);
})();
