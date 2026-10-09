import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauri } from "./lib/tauri";

function BrowserNotice() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        color: "#f4f4f5",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 540,
          textAlign: "center",
          border: "1px solid #1b1b1f",
          background: "#0b0b0d",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow: "0 0 40px rgba(255,255,255,0.03)",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>🖥️</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, letterSpacing: "0.02em" }}>
          Xryloth must run as a desktop app
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#a1a1aa", marginBottom: 14 }}>
          You opened the Vite dev server in a web browser (
          <code style={{ color: "#f4f4f5" }}>http://localhost:1420</code>). That page has no Tauri
          IPC bridge, so every <code style={{ color: "#f4f4f5" }}>invoke()</code> call fails.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#a1a1aa" }}>Launch the real window instead:</p>
        <pre
          style={{
            textAlign: "left",
            background: "#111114",
            border: "1px solid #1b1b1f",
            borderRadius: 10,
            padding: "12px 14px",
            marginTop: 14,
            fontSize: 12.5,
            color: "#f4f4f5",
            overflowX: "auto",
          }}
        >
          npm run tauri dev
        </pre>
        <p style={{ fontSize: 12, color: "#71717a", marginTop: 14 }}>
          (Or run the packaged <code style={{ color: "#a1a1aa" }}>Xryloth</code> AppImage / installed{" "}
          <code style={{ color: "#a1a1aa" }}>xryloth</code>.)
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTauri() ? <App /> : <BrowserNotice />}
  </React.StrictMode>
);
