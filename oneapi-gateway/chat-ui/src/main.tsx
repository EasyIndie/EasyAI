import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { ThemeProvider } from "@easyai/ui";
import "@easyai/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
