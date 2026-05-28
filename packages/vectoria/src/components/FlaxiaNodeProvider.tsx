"use client";

import { useEffect } from "react";
import { initVectoriaNode } from "@/lib/flaxia-node";

export function FlaxiaNodeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initVectoriaNode();
  }, []);

  return <>{children}</>;
}
