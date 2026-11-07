import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Development builds expose the stores for tests first (see devHooks.ts);
// production builds leave the import out altogether.
const ready = import.meta.env.DEV ? import("./devHooks").then((m) => m.installDevHooks()) : Promise.resolve();

void ready.then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
