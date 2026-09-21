# Reference material — NOT part of the product

`betradar-virtual-dogs-banner.mp4` is the banner video from Betradar's (Sportradar's) Virtual Dogs product page
(https://betradar.com/virtual-sports-betting/virtual-dogs/), downloaded on request **as a reference clip only**, to
look at pacing, camera and presentation when designing our own race screen.

**It is Sportradar's copyrighted footage.** It is deliberately:

* not referenced by any code and not played anywhere in the app,
* excluded from the Docker image (`.dockerignore`),
* not to be shipped, streamed to shop displays, or edited/upscaled into something we distribute.

Using it, or their dog art and race screenshots, in a commercial betting product would need a licence from them.
Our dog race uses only original artwork (`../web/DogArt.tsx`) and animation (`../web/raceMath.ts`).

What the Betradar page describes, and what we took as *ideas* (not assets):

| Betradar Virtual Dogs | Our dog race |
|---|---|
| Six-dog races, non-stop | Six dogs, a new race every ~100 s (configurable) |
| Full forecast and tricast markets, combination bets | Win, Place (top 3), Forecast, Quinella. Tricast is a natural next addition |
| Multiple distances and day/night tracks | One 480 m track for now. Distance/track are already fields of each race's snapshot |
| "Dynamic performance behaviour" | Each dog gets a published strength per race; odds are derived from it |
