export const WALLPAPER_SEASONS = {
  "set-17": {
    season: 17,
    labelKey: "seasonName",
    wallpapers: [
      {
        id: "set17-cosmic-court",
        labelKey: "wallpaperCosmicCourt",
        url: "/assets/wallpapers/set-17/cosmic-court.jpg",
        position: "center center",
        accent: "#c84f91",
        accentSecondary: "#8a62dc"
      },
      {
        id: "set17-stargazer-convergence",
        labelKey: "wallpaperStargazerConvergence",
        url: "/assets/wallpapers/set-17/stargazer-convergence.png",
        position: "center center",
        focusSize: "cover",
        accent: "#6b63df",
        accentSecondary: "#34b9d6"
      },
      {
        id: "set17-yasuo",
        labelKey: "wallpaperYasuo",
        url: "/assets/wallpapers/set-17/yasuo.png",
        position: "62% center",
        focusSize: "cover",
        accent: "#177de1",
        accentSecondary: "#18c4db"
      },
      {
        id: "set17-soraka",
        labelKey: "wallpaperSoraka",
        url: "/assets/wallpapers/set-17/soraka.jpg",
        position: "38% center",
        focusSize: "cover",
        accent: "#35a875",
        accentSecondary: "#d5a548"
      }
    ]
  },
  "set-18-pbe": {
    season: 18,
    labelKey: "seasonPbePreview",
    wallpapers: []
  }
};

export const DEFAULT_WALLPAPER_ID = "set17-stargazer-convergence";

export const WALLPAPERS = Object.values(WALLPAPER_SEASONS)
  .flatMap((season) => season.wallpapers.map((wallpaper) => ({
    ...wallpaper,
    season: season.season,
    seasonLabelKey: season.labelKey
  })));

export function wallpapersForSeason(seasonId) {
  const season = WALLPAPER_SEASONS[seasonId];
  if (!season) return [];
  return season.wallpapers.map((wallpaper) => ({
    ...wallpaper,
    season: season.season,
    seasonLabelKey: season.labelKey
  }));
}

export function wallpaperById(id, seasonId = null, defaultId = DEFAULT_WALLPAPER_ID) {
  const wallpapers = seasonId ? wallpapersForSeason(seasonId) : WALLPAPERS;
  return wallpapers.find((wallpaper) => wallpaper.id === id)
    ?? wallpapers.find((wallpaper) => wallpaper.id === defaultId)
    ?? wallpapers[0]
    ?? null;
}
