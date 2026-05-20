import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Admin from "./Admin.jsx";
import "./compass.css";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "40px", fontFamily: "monospace", color: "#c0392b" }}>
          <h2>页面崩溃</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>
            {this.state.error?.message}{"\n\n"}{this.state.error?.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: "16px", padding: "8px 16px", cursor: "pointer" }}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const isAdmin = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isAdmin ? <Admin /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
