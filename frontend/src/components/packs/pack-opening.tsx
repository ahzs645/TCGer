"use client";

import { useCallback, useState } from "react";

import {
  PackOpening as SharedPackOpening,
  type PackOpeningEvent,
} from "@tcg/pack-core/experience";

const CONFIGURED_ASSET_BASE =
  process.env.NEXT_PUBLIC_PACK_ASSET_BASE_URL?.replace(/\/+$/, "") ?? "";

/**
 * Production reads the projected wrapper sheets from R2. A failed remote load
 * remounts against the bundled pack assets so local/offline use still works.
 */
export function PackOpening() {
  const [assetBase, setAssetBase] = useState(CONFIGURED_ASSET_BASE);
  const handleEvent = useCallback(
    (event: PackOpeningEvent) => {
      if (assetBase && event.type === "error") setAssetBase("");
    },
    [assetBase],
  );

  return (
    <SharedPackOpening
      key={assetBase || "bundled"}
      assetBase={assetBase}
      onEvent={handleEvent}
    />
  );
}
