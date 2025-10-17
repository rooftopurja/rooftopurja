(() => {
  const mount = document.getElementById("topnav");
  if (!mount) return;
  fetch("nav.html", {cache:"no-store"})
    .then(r => r.text())
    .then(html => {
      // replace mount with header
      mount.outerHTML = html;
      const page = (mount.dataset.active || (location.pathname.split("/").pop() || "meter.v2.html")).toLowerCase();
      const a = document.querySelector(`.tabs a[data-page="${page}"], .tabs a[href="${page}"]`);
      if (a) a.classList.add("active");
    })
    .catch(()=>{});
})();