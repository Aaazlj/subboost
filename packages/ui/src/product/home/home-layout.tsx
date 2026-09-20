"use client";

import * as React from "react";
import { SimpleConfigPanel } from "@subboost/ui/product/converter/simple-config-panel";

export function HomeLayout() {
  return (
    <div className="min-h-[calc(100vh-4rem)] w-full flex flex-col justify-start">
      <SimpleConfigPanel />
    </div>
  );
}
