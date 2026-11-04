import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./styles.css";

async function mount() {
  try { await document.fonts.load('32px "Caveat"'); } catch { /* system font fallback */ }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void mount();
