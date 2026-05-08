import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import logoUrl from "./images/EduTech Logo.png";
import "./styles.css";

function setFavicon(href: string) {
  const existing = document.querySelector<HTMLLinkElement>("link[rel~='icon']");

  if (existing) {
    existing.href = href;
    existing.type = "image/png";
    return;
  }

  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = href;
  document.head.appendChild(link);
}

setFavicon(logoUrl);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
