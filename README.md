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
