# BARRICADE game art — French civic direction

This is original game-only art. The defender is a fixed character for the game, not a Memba collection portrait or a claim that a player's NFT is rendered. The art draws on the French Revolution's language of liberty, equal rights and a street-built Paris barricade. The opposing side is always unmanned machinery.

## Assets and placement

| File in `frontend/public/games/barricade/` | Game role |
| --- | --- |
| `paris-dusk.webp` | 2.5D battlefield plate, with Paris roofline, Notre-Dame-like towers and the Bastille in the distance |
| `citizen.webp` | Defender at the parapet, in civilian dress, liberty cap and a small tricolour cockade |
| `broadcast.webp` | Looming horizon boss and broadcast machine |
| `drone.webp`, `walker.webp`, `testudo.webp`, `mortar.webp` | Four readable machine chassis families |

All seven final assets were generated with the built-in imagegen tool on 2026-09-22, then resized and converted to WebP for the game. The originals are PNGs with alpha for the six cutouts. The files together add about 430 KiB; they load only when the 2.5D game mounts. Missing assets fall back to the procedural renderer. The marshal remains procedural so its shield-open timing stays visible.

## Prompt set

Shared direction for every image: original French neo-bande dessinée game illustration; bold clean near-black ink contours, flat cel colours, hard-edged cut-paper shadows, restrained riso screen texture; stock `#141026`, ink `#0a0812`, off-white `#efe7d4`, ochre brass `#dba43c`, French blue `#2b49a0`, small threat vermilion `#e0392b`. Keep silhouettes readable at 30–120 px. Avoid gradients, glow, airbrush, CGI, photorealism, anime, text, logos, watermarks, real-person likenesses, communist/Russian/Soviet iconography, red stars, hammer and sickle, and raised-fist poster imagery.

- **Paris plate:** a wide dusk view down an 18th-century Paris street toward a roofline, Notre-Dame-like cathedral and distant Bastille. Keep the road and central three lanes dark and quiet for active sprites. Small tricolour bunting; no foreground barricade, people or machines.
- **Citizen:** one resolute Parisian woman in a dark-blue 1790s civilian worker coat, off-white neckcloth and modest red Phrygian liberty cap with a blue-white-red cockade. Upper-body cutout with a humane expression, no weapon, hand near lapel, transparent background.
- **Broadcast:** a large unmanned printing-and-surveillance tower on treads with brass loudspeaker trumpets, a central signal box and three red optics. Broad distinct masses, transparent background.
- **Testudo:** a low, wide moving shield wall with pale riveted plates, a recessed red sensor and visible wheel/tread base. It is an armored mechanical counter to frontal shots, transparent background.
- **Drone:** a narrow flying clockwork surveillance wedge with two broad rotor housings and one red optical lens, transparent background.
- **Walker:** a stout two-legged clockwork enforcer with separated walking legs, one pale side shield and one red viewing slit, transparent background.
- **Mortar:** a squat wheeled carriage with an angled brass launch tube, cranked adjustment wheel and small red sight aperture, transparent background.

The generated concept study that preceded these assets was a visual reference only. It was not placed in the game: it contained baked-in enemies and a defender that would conflict with live sim state.
