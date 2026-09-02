/* Apply theme before paint to avoid flash. Loaded as external script (CSP script-src 'self'). */
(function () {
  try {
    if (!localStorage.getItem("grok-desktop-carvis-light")) {
      localStorage.setItem("grok-desktop-theme", "light");
      localStorage.setItem("grok-desktop-carvis-light", "1");
    }
    var t = localStorage.getItem("grok-desktop-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
