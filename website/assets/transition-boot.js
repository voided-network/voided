(() => {
  const key = "voided:matrix-transition";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  try {
    const incoming = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!incoming?.timestamp || Date.now() - incoming.timestamp >= 8000) return;
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    document.documentElement.classList.add("matrix-remold-pending");
    window.setTimeout(() => {
      document.documentElement.classList.remove("matrix-remold-pending");
    }, 4000);
  } catch {
    // Hardened browsing modes can disable session storage. Navigation remains usable.
  }
})();
