"use client";

import * as React from "react";

export const MapStageContext = React.createContext<HTMLElement | null>(null);

export function useMapStageContainer() {
  return React.useContext(MapStageContext);
}
