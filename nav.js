// FINAL top navigation links
const LINKS = [
  { href: "/meter.v2.html",            label: "Meter" },
  { href: "/inverter_analytics.html",  label: "Inverter Analytics" },
  { href: "/inverter_overview.html",   label: "Inverter Data Overview" },
  { href: "/inverter_faults.html",     label: "Inverter Faults" },
  { href: "/maintenance.html",         label: "Maintenance" }
];

// Robust active detection (ignores query string & trailing slashes)
function isActive(href) {
  const clean = (p) => p.toLowerCase().split("?")[0].replace(/\/+$/,"");
  const cur = clean(location.pathname);
  const target = clean(href);
  return cur === target;
}

(function(){
  const placeholder = document.getElementById("global-nav");
  if(!placeholder) return;
  const bar = document.createElement("div");
  bar.className = "navbar";
  bar.innerHTML = `
    <div class="navwrap">
      <div class="brand">Solar Plant Dashboard</div>
      <div class="navspacer"></div>
      ${LINKS.map(l => {
        const active = isActive(l.href) ? "active" : "";
        return `<a class="navlink ${active}" href="${l.href}">${l.label}</a>`;
      }).join("")}
    </div>`;
  placeholder.replaceWith(bar);
})();
