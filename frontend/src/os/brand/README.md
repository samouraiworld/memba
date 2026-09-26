# Beta identity artwork

Approved indigo folded-M set and centre-safe Aqua share card. Source compositions
are `share.html` (variant `#d`) and `icons.html`; these are design references and
are not published by the build. The exported files retain the approved bytes.

The build emits only the explicit `OS_BRAND_FILES` list to `/brand/os/`, and only
when both `VITE_MEMBA_OS` and `MEMBA_OS_BETA_SITE` are `true`. Never move these files
to `public/`: that directory is copied into classic builds too.

The 1200×630 image is the social card (including centre-square and 2:1 crops).
The 1200×1200 image is for manual posts only. The maskable icon includes its safe
padding; the ordinary 192/512 icons retain transparency.
