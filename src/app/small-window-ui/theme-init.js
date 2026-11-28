(function () {
  try {
    var mode = localStorage.getItem("tft_agent_theme_mode_v1");
    var dark = mode === "dark"
      || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
