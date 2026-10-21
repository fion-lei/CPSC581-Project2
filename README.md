# CPSC581-Project2 - Ghost Lens

Phones as "ghost lenses" into a shared 3D model: an expert guides a novice through a
CAD part remotely, in AR.

## Run locally
```bash
npm install
npm run dev
```
Open the HTTPS network address printed by Vite on a phone connected to the same
Wi-Fi (accept the certificate warning).

## Deployed
Pushing to `main` deploys to GitHub Pages:
https://fion-lei.github.io/CPSC581-Project2/

## Connecting
1. Start Ghost Lens on both devices. They do not need to be on the same Wi-Fi.
2. On the expert's device, select **Expert**. This opens the room. Read the displayed
   four-digit room code to the novice over your external voice call. The expert can
   tap **Enter AR** straight away and wait there for the novice.
3. On the novice's device, select **Novice** and enter that code. The app connects
   automatically; **Enter AR** unlocks once it shows **Connected**.

The connection status is shown on the start screen. If a connection drops, the app
tries to reconnect automatically. If it stays on **Connecting** or **Waiting**, check
that both devices entered the same code and that the room is not already in use by
another session. Some networks block WebRTC; try a phone hotspot if the devices
cannot connect.

Devices communicate peer-to-peer using WebRTC, with PeerJS providing connection
signaling. For desktop testing, open two tabs and use the same room code in both:
`?role=expert&room=1234` and `?role=novice&room=1234`.

## Devices
- Android + Chrome: full support (AR, vibration)
- iPhone: open
  https://appclip.needle.tools/ar?url=https%3A%2F%2Ffion-lei.github.io%2FCPSC581-Project2%2F
  in Safari (AR without vibration)

## Expert HUD (issue #7)

After entering the scene, the expert has a bottom toolbar: **Grab**, **Pin**,
**Draw**, and **View**. Exactly one mode is selected; **View** is the default.
This issue provides mode selection; the tool actions are implemented separately.
The novice does not get the expert toolbar or crosshair.

The centre crosshair turns orange when the camera points at a part mesh, and
white when it misses. Ghost phones and edge outlines are excluded. The toolbar
and crosshair hide during AR placement/re-placement or tracking loss, then return
when the part is ready. Desktop testing uses the orbit camera.

The top chips show role/room, connection state, and a manual external-call status.
Tap **Not on call** / **On call** to mark your separate voice call's state. This
does not start audio or infer call status from the data connection.

For the other tool implementations, import `getMode()` and
`onModeChange(handler)` from `src/expert-tools.js`. The latter immediately reports
the current mode and returns an unsubscribe function. Check the local role before
performing expert actions and finish/cancel held actions when the mode changes.
`createCentreAim(modelRoot, modelPivot)` is also available for centre-ray queries;
its `update(camera, ready)` returns a Three.js intersection with a world-space
`point`, or null. Convert that point to the required local frame before syncing.

Validation:
```bash
npm test
npm run build
```
In two desktop tabs, join as Expert and Novice and continue without AR. Confirm
only the expert sees the four tools; selecting each leaves exactly one active.
Orbit until the crosshair misses/hits the part to check white/orange feedback.
Toggle the call chip and verify it is independent of network connection status.
On an AR device, verify placement, re-placement, and STOP AR remain accessible;
toolbar taps must not select/grab/draw on the scene underneath.

AI assistance: ChatGPT assisted implementation, review and test design for the
expert HUD. Physical-device AR checks must be performed on the demo devices.
