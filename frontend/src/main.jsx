import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Admin from "./Admin.jsx";
import "./compass.css";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(error, info) {
    // 堆栈只进控制台，不渲染给终端用户（避免暴露源码路径）
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "40px", fontFamily: "system-ui, sans-serif", color: "#c0392b" }}>
          <h2>页面出了点问题</h2>
          <p style={{ fontSize: "14px", color: "#555" }}>{this.state.error?.message || "未知错误"}</p>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: "16px", padding: "8px 16px", cursor: "pointer" }}>
            重试
          </button>
          <button onClick={() => window.location.reload()} style={{ marginTop: "16px", marginLeft: "8px", padding: "8px 16px", cursor: "pointer" }}>
            刷新页面
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
