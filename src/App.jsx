import React, { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n/index.js";
import AppBootstrap from "./views/shell/AppBootstrap.jsx";

export default function App() {
  // Created at mount time (not module-load time) so it always reflects
  // the language preference current in appSettings/localStorage when
  // the app actually starts — important for tests that set up
  // localStorage before rendering, and harmless in production where
  // App mounts exactly once.
  const [i18n] = useState(() => createI18n());

  return (
    <I18nextProvider i18n={i18n}>
      <AppBootstrap />
    </I18nextProvider>
  );
}
