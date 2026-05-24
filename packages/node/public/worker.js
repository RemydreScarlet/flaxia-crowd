self.onmessage = async (s) => {
  const { id: r, workload: t, payload: a } = s.data;
  try {
    let e;
    switch (t) {
      case "ai-inference":
        const { handleAiInference: o } = await import("./assets/ai-inference-BIbbLy4o.js");
        e = await o(a);
        break;
      case "image-process":
        const { handleImageProcess: n } = await import("./assets/image-process-CFSjI3n4.js");
        e = await n(a);
        break;
      case "container":
        const { handleContainer: i } = await import("./assets/container-D7x3Jat0.js");
        e = await i(a);
        break;
      default:
        throw new Error(`Unknown workload type: ${t}`);
    }
    self.postMessage({ id: r, type: "done", result: e });
  } catch (e) {
    self.postMessage({ id: r, type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
