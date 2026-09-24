/** Aqua wallpapers — each has a light and a dark rendering (D9). */
export interface Wallpaper {
    id: string
    name: string
    light: string
    dark: string
}

export const WALLPAPERS: readonly Wallpaper[] = [
    { id: "aqua", name: "Aqua",
      light: "radial-gradient(120% 90% at 18% 8%,#CADCFF,transparent 60%),radial-gradient(100% 80% at 92% 95%,#F7D6E7,transparent 55%),#E8EEF8",
      dark: "radial-gradient(120% 90% at 18% 8%,#25346A,transparent 60%),radial-gradient(100% 80% at 92% 95%,#4B2548,transparent 55%),#0E1220" },
    { id: "lagoon", name: "Lagoon",
      light: "radial-gradient(110% 90% at 85% 0%,#C4EFE1,transparent 60%),radial-gradient(90% 80% at 0% 100%,#D3DAFF,transparent 60%),#EDF3F2",
      dark: "radial-gradient(110% 90% at 85% 0%,#12433C,transparent 60%),radial-gradient(90% 80% at 0% 100%,#232A5E,transparent 60%),#0C1315" },
    { id: "dawn", name: "Dawn",
      light: "linear-gradient(160deg,#FDE6D3,#E6DFFA 55%,#D6E9F9)",
      dark: "linear-gradient(160deg,#35232A,#1F1C38 55%,#11233A)" },
    { id: "ember", name: "Ember",
      light: "radial-gradient(90% 70% at 50% 110%,#FFD4B0,transparent 60%),linear-gradient(180deg,#B9C9F2,#E9D6F0)",
      dark: "radial-gradient(90% 70% at 50% 110%,#6A351C,transparent 60%),linear-gradient(180deg,#121A33,#2A1C33)" },
    { id: "mist", name: "Mist",
      light: "linear-gradient(180deg,#DDE4EE,#F4F6F9)",
      dark: "linear-gradient(180deg,#11141B,#1C212B)" },
]

export const DEFAULT_WALLPAPER = WALLPAPERS[0]

export function getWallpaper(id: string | null | undefined): Wallpaper {
    return WALLPAPERS.find((w) => w.id === id) ?? DEFAULT_WALLPAPER
}
