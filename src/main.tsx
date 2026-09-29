import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import App from "./app";
import { ErrorBoundary } from "./components/error-boundary";
import i18n from "./i18n";
import { installErrorBuffer } from "./lib/error-buffer";
import "./app.css";

installErrorBuffer();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <BrowserRouter>
          <App />
          <Toaster closeButton position="bottom-right" richColors />
        </BrowserRouter>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapacitorApp.exitApp();
    }
  });
}
