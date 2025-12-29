(function () {
  // Allow login page without checks
  if (location.pathname.endsWith("login.html")) return;

  const token = localStorage.getItem("urja_token");
  const email = localStorage.getItem("urja_email");

  // Simple session check (NO JWT parsing)
  if (!token || !email) {
    location.replace("/login.html");
    return;
  }

  // Expose user
  window.USER = Object.freeze({ email });
})();
