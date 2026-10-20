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
The expert picks **Expert** (a room code is filled in) and reads the code out over the
call; the novice picks **Novice** and types it. The chip at the top shows
connecting / connected / disconnected and retries on its own.
For testing, `?role=expert&room=1234` / `?role=novice&room=1234` skip the start screen.

Phones talk peer-to-peer (WebRTC via the PeerJS cloud server). Lab Wi-Fi: not tested
yet. If it blocks the connection, use a phone hotspot.

## Devices
- Android + Chrome: full support (AR, vibration)
- iPhone: open
  https://appclip.needle.tools/ar?url=https%3A%2F%2Ffion-lei.github.io%2FCPSC581-Project2%2F
  in Safari (AR without vibration)
