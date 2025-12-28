(function () {
  if (location.pathname.endsWith("login.html")) return;

  const token = localStorage.getItem("urja_token");
  if (!token) {
    location.replace("/login.html");
    return;
  }

  const [payload] = token.split(".");
  try {
    const data = JSON.parse(atob(payload));
    if (Date.now() > data.exp) throw 0;
    window.USER = Object.freeze({ email: data.email });
  } catch {
    localStorage.removeItem("urja_token");
    location.replace("/login.html");
  }
})();
