import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@gmermaid/app/editor";
import "@gmermaid/app/style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
