(async function () {
  if (location.pathname.endsWith("login.html")) return;

  const r = await fetch("/.auth/me");
  const j = await r.json();

  if (!j?.clientPrincipal) {
    location.replace("/login.html");
    return;
  }

  window.USER = Object.freeze({
    email: j.clientPrincipal.userDetails
  });
})();
