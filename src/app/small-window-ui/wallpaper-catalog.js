export const WALLPAPER_SEASONS = {
  "set-17": {
    season: 17,
    labelKey: "seasonName",
    wallpapers: [
      {
        id: "set17-cosmic-court",
        labelKey: "wallpaperCosmicCourt",
        url: "/assets/wallpapers/set-17/cosmic-court.jpg",
        position: "center center"
      },
      {
        id: "set17-stargazer-convergence",
        labelKey: "wallpaperStargazerConvergence",
        url: "/assets/wallpapers/set-17/stargazer-convergence.jpg",
        position: "center center",
        focusSize: "cover"
      }
    ]
  }
};

export const DEFAULT_WALLPAPER_ID = "set17-stargazer-convergence";

export const WALLPAPERS = Object.values(WALLPAPER_SEASONS)
  .flatMap((season) => season.wallpapers.map((wallpaper) => ({
    ...wallpaper,
    season: season.season,
    seasonLabelKey: season.labelKey
  })));

export function wallpaperById(id) {
  return WALLPAPERS.find((wallpaper) => wallpaper.id === id)
    ?? WALLPAPERS.find((wallpaper) => wallpaper.id === DEFAULT_WALLPAPER_ID)
    ?? WALLPAPERS[0];
}
