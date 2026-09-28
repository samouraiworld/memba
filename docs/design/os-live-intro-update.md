# OS entry, Live, and update controls

Status: Implemented — local acceptance passed; PR open, CI pending

Integration: Depends on shell QA PR #1345. Merge that branch first; this change preserves its explicit locks and account-scoped desktop layouts.

## User behavior

- A plain `/os` visit shows the short boot animation and Connect/Guest choice each time. Reduced motion skips the animation. Direct OS links continue to open their requested content immediately.
- Settings > Desktop offers **Skip intro automatically**. It skips the animation and choice on future plain visits, without changing wallet authentication. The choice is off by default and stays on this device.
- Choosing Guest disconnects a resumed member. Choosing Connect uses an already resumed session without another signature. Repeating the intro preserves saved desktop windows.
- Live activity appears by hovering or focusing the desktop network selector. The selector still opens its network menu on click. Settings > Desktop offers **Add the Widget**; the desktop Live widget is off by default and the preference persists locally. The Live window remains available.
- The update notice explains that a reload is user initiated, offers a deferral control and a compact way back, and keeps reload disabled during wallet decisions and transaction verification.
- `memba_dao` member display is a separate follow-up; this change does not alter DAO data fetching.

## Runnable acceptance

1. Entry and preference unit tests prove default repeat behavior, skip persistence, and reduced-motion/deep-link exclusions.
2. Browser tests prove repeat boot and Connect/Guest choice, saved windows, Live hover/focus and opt-in widget, and update notice actions.
3. Frontend unit, lint, build, OS bundle gate and Chromium OS E2E pass. The attribution checker runs before push.
