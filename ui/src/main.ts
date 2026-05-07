import { initApp } from "./components/App.ts";

document.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");
  if (app) {
    void initApp(app);
  }
});
