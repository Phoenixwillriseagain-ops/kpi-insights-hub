import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: DashboardRedirect,
});

function DashboardRedirect() {
  useEffect(() => {
    window.location.replace("/dashboard.html");
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: "#555" }}>
      Loading dashboard…
    </div>
  );
}
