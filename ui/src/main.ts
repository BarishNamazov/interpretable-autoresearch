import { initApp } from "./components/app.ts";

// Entry point
document.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");
  if (app) {
    initApp(app);
  }
});
