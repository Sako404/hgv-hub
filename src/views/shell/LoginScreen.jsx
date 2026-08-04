import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../context/SessionContext.jsx";
import { Field } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from "../shared/styles.js";

const screenStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#14161A",
  fontFamily: "'Barlow', sans-serif",
  padding: 24,
};

const cardStyle = {
  width: "100%",
  maxWidth: 360,
  background: "#1E2126",
  border: "1px solid #2A2E35",
  borderRadius: 10,
  padding: 24,
};

/**
 * Server-mode-only: rendered by AuthGate when there's no live session
 * cookie yet. Local (IndexedDB) mode never reaches this component —
 * see SessionContext.jsx's apiMode split.
 */
export default function LoginScreen() {
  const { t } = useTranslation("auth");
  const { login, register } = useSession();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={screenStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#EDEEF0", marginTop: 0 }}>
          {mode === "login" ? t("login.title") : t("register.title")}
        </h1>
        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <Field label={t("register.name")}>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label={t("login.email")}>
            <input style={inputStyle} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("login.password")}>
            <input style={inputStyle} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <div style={{ color: "#FF5A5F", fontSize: 13, marginBottom: 14 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="submit" style={primaryBtnStyle} disabled={submitting}>
              {submitting
                ? mode === "login"
                  ? t("login.submitting")
                  : t("register.submitting")
                : mode === "login"
                  ? t("login.submit")
                  : t("register.submit")}
            </button>
          </div>
        </form>
        <button
          type="button"
          style={{ ...secondaryBtnStyle, width: "100%", marginTop: 14, padding: "10px 0" }}
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? t("login.switchToRegister") : t("register.switchToLogin")}
        </button>
      </div>
    </div>
  );
}
