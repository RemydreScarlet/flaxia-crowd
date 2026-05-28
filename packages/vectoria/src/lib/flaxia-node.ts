import { initFlaxiaNode } from "@flaxia/node";

const ORCHESTRATOR_URL_KEY = "flaxia_orchestrator_url";

function getOrchestratorUrl(): string {
  if (typeof window === "undefined") return "http://localhost:8787";
  const saved = localStorage.getItem(ORCHESTRATOR_URL_KEY);
  if (saved) return saved;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:8787";
  }
  return "https://flaxia-worker.remydre8.workers.dev";
}

export function initVectoriaNode() {
  initFlaxiaNode({
    orchestratorUrl: getOrchestratorUrl(),
    siteId: "vectoria",
    consent: {
      brandName: "Vectoria Search",
      position: "bottom-right",
      accentColor: "#4285f4",
    },
    capabilities: ["web-crawl", "vector-embed", "vector-store", "vector-query"],
  });
}
