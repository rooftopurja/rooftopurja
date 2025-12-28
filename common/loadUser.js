(function () {
  const page = (location.pathname || "").split("/").pop().toLowerCase();

  // 🔒 Skip login page
  if (page === "login.html") return;

  function hide() { document.body.style.opacity = "0"; }
  function show() { document.body.style.opacity = "1"; }

  hide();

  async function start() {
    // 🔑 Check SWA auth
    const me = await fetch("/.auth/me").then(r => r.json()).catch(() => null);
    const user = me?.clientPrincipal;

    if (!user) {
      window.location.replace("login.html");
      return;
    }

    // 🔐 Load access from backend (uses req.user)
    const r = await fetch("/api/GetUserAccess", { cache: "no-store" });
    const access = await r.json();

    if (!access.success) {
      window.location.replace("login.html");
      return;
    }

    // Menu permissions
    const p = access.pages || {};
    if (!p.meter) document.querySelector("#menu-meter")?.classList.add("hide");
    if (!p.inverteranalytics) document.querySelector("#menu-inverteranalytics")?.classList.add("hide");
    if (!p.inverterdataoverview) document.querySelector("#menu-inverterdataoverview")?.classList.add("hide");
    if (!p.inverterfaults) document.querySelector("#menu-inverterfaults")?.classList.add("hide");
    if (!p.maintenance) document.querySelector("#menu-maintenance")?.classList.add("hide");

    show();
  }

  start();
})();
