import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import "./styles/carvis-shell.css";
import "./styles/github-markdown-light.css";
import "./styles/markdown-paper-ink.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  const el = document.getElementById("boot-splash");
  if (el) {
    el.setAttribute("data-done", "1");
    el.classList.add("boot-splash--done");
  }
});
