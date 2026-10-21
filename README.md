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

## Mid-air sketching (issue #9)

Select **Draw** on the expert toolbar. In AR, hold the screen and move the phone:
points follow the centre ray's part hit, or sit 15 cm in front of the phone when
it misses. On desktop, drag directly on the part to draw; choose **View** to
orbit the camera again. A mouse leaving the surface ends that stroke segment.
The novice sees the orange strokes live. **Clear** removes all sketches for both
people. The expert's current sketches are replayed when a novice joins/rejoins.
Reloading the expert page starts a new, empty sketch document.

Points are at least 5 mm apart. Three.js wide lines render at 3 mm thickness;
surface samples are lifted by half that width to prevent depth flicker. Geometry
and network points are in `modelRoot` coordinates. The sketch group is a sibling
of `modelPivot`: turning the part must not turn existing guidance. Issue #8 should
continue changing `modelPivot`, leaving table placement on `modelRoot`.

`src/sketch.js` owns sampling, geometry, and the shared sketch document;
`src/sketch-input.js` handles the Draw controls and desktop/XR input. It releases
held strokes on mode changes, tracking loss, placement, lost input sources,
window blur, and session end. DOM buttons suppress XR selection. Drawing pauses
OrbitControls while held; other tool modes keep their own input behavior.

Messages use the existing reliable PeerJS channel:
- `stroke`: `{ t: "stroke", epoch, id, start, points: [[x, y, z], ...] }`, containing
  new points only, in batches of up to 32, sent about every 50 ms and on release.
- `clear`: `{ t: "clear", epoch }`. A new epoch prevents old stroke packets from
  restoring cleared marks. Reconnect replay sends clear followed by all strokes.

The novice accepts these only from the peer identified as expert. Payloads have
finite-coordinate, batch, point-count, and sequence checks. A sketch is limited
to 64 strokes of 1,024 points each to bound phone memory. Release to start another
stroke at the point limit, or Clear when the document is full. Geometry buffers
are reused while drawing and disposed when cleared.

### Sketch validation

Run `npm test` and `npm run build`. The automated tests cover ray sampling,
minimum spacing, transformed placements, stroke deltas, replay, clearing,
malformed messages, resource disposal, and limits, alongside the issue #7 tests.

Manual desktop check (two tabs, expert and novice in the same room):
1. Select Draw on the expert. Drag across the part; the novice should see orange
   strokes before the drag ends, and the expert camera must not orbit.
2. Draw outside the part: no stroke. Leave/re-enter the surface during a drag:
   separate stroke segments, with no line bridging the empty space.
3. Select View and orbit the scene. Return to Draw and add another stroke.
4. Reload the novice; existing strokes should reappear after connection.
5. Clear on the expert; both views should be empty.

On the AR demo devices, verify surface and mid-air drawing, release, tracking
loss, re-placement, and STOP AR. Button taps must not create strokes. Test again
with issue #8 merged: rotating the part should leave sketches fixed to the table.
Development browser checks used simulated transport and XR events; they do not
replace real-phone WebXR or real-network testing.

AI assistance: ChatGPT assisted the sketch implementation, review, and tests.
