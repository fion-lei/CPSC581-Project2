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

## Devices
- Android + Chrome: full support (AR, vibration)
- iPhone: open
  `https://appclip.needle.tools/ar?url=https%3A%2F%2Ffion-lei.github.io%2FCPSC581-Project2%2F`
  in Safari
  (AR without vibration)
