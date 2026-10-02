/** Minimal menu surface used by the weather overlay's render policy. */
export interface WeatherOverlayMenu {
  isOpen(): boolean;
}

/** Weather is a world effect, so sibling UI menus must cover it completely. */
export function weatherOverlaySuspended(
  demoMenu: WeatherOverlayMenu | null,
  saveMenu: WeatherOverlayMenu | null,
): boolean {
  return (demoMenu?.isOpen() ?? false) || (saveMenu?.isOpen() ?? false);
}
