import "@fontsource-variable/golos-text";
import "@fontsource-variable/sofia-sans-condensed";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ScenarioPage } from "./ScenarioPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/$/, "") === "/scenarios" ? <ScenarioPage /> : <App />}
  </StrictMode>,
);
