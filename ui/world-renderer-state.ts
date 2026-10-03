import type { Accessor } from "solid-js";

/** Keep a mounted world subtree on its last valid placement while GameView's
 * outer Show switches to the legacy renderer. Solid may update child memos
 * before disposing that subtree during a placed -> unplaced map change. */
export function placedMapAccessor(
  activeMapId: Accessor<string>,
  hasMap: (mapId: string) => boolean,
  fallbackMapId: string,
): Accessor<string> {
  let lastPlaced = hasMap(activeMapId()) ? activeMapId() : fallbackMapId;
  return () => {
    const next = activeMapId();
    if (hasMap(next)) lastPlaced = next;
    return lastPlaced;
  };
}
