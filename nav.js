document.addEventListener("DOMContentLoaded", () => {
  const path = location.pathname.split("/").pop() || "meter.v2.html";
  document.querySelectorAll(".tabs a").forEach(a => {
    const want = a.getAttribute("data-page") || a.getAttribute("href");
    if (want && path.toLowerCase().endsWith(want.toLowerCase())) a.classList.add("active");
  });
  // clean any stray leading "\" or "\r" text node once
  const firstNode = document.body.firstChild;
  if (firstNode && firstNode.nodeType === 3) {
    firstNode.nodeValue = firstNode.nodeValue.replace(/^[\\\r\s]+/, "");
  }
});