# CPSC581-Project2 - Ghost Lens

Phones act as "ghost lenses" into a shared 3D model. An expert uses their phone
to guide a novice through a CAD part remotely in AR.

**Live demo:** https://fion-lei.github.io/CPSC581-Project2/

## Features

- **Shared model space:** each person places the part on their own table. Shared
  guidance stays positioned relative to the part.
- **Ghost phones:** each person sees a translucent ghost of the other's phone.
  Orange represents the expert and blue represents the novice.
- **Grab and turn:** the expert moves and rotates the part using their phone.
  The novice's copy follows.
- **Mid-air sketching:** the expert draws on the part or in the air to guide the novice.
- **Laser pins with fixes:** the expert marks a problem and suggests a fix.
  The novice confirms it with a check.
- **Viewpoint matching:** the expert saves an angle. An arrow, alignment bar,
  rising tone, and haptics guide the novice into the same view.

## Requirements

For a shared session, both people need a device with internet access and a
separate voice call. Voice is not built into this project. The devices do not need to be on the same Wi-Fi.

Phone AR requires camera permission and HTTPS. The live demo provides HTTPS
without any local setup.

| Device | Support |
| --- | --- |
| Android | Use Chrome on an AR-capable phone for AR and haptics. |
| iPhone | Open [Needle's App Clip](https://appclip.needle.tools/ar?url=https%3A%2F%2Ffion-lei.github.io%2FCPSC581-Project2%2F) from Safari for AR. Haptics are unavailable. |
| Desktop | Use the non-AR view for testing. No camera or WebXR support is needed. |

## Usage

1. Open the live demo on both devices and start a separate voice call.
2. Choose **Expert** on one device and share its four-digit room code with the novice.
   Choose **Novice** on the other device and enter the expert's room code.
3. Tap **Enter AR**, allow camera access, and scan your table. Each person taps
   **Place part** to place their own copy. Without AR, choose **Continue without AR**.
4. Guide the novice using the expert's tools:
   - **Grab:** press and hold the part, then move or rotate the phone to move or
     turn it on both devices. Release to set it down. Use **Reset part** to reset it.
   - **Pin:** aim at the part, hold and release, choose a problem and fix, then
     tap **Send pin**. The novice can find the pin and confirm it with the check button.
   - **Draw:** hold the screen and move the phone to sketch on the part or in the
     air. Use Undo to remove the latest stroke or the trash icon to clear all
     strokes on both devices.
   - **View:** tap View to save your current angle. The novice follows the arrow
     toward the saved ghost camera and turns to match its direction, using the
     alignment bar and rising tone as guidance.
5. Tap **Re-place** to choose a new table position or **Stop AR** to leave AR.

If the connection drops, the app tries to reconnect automatically. If it stays
on **Connecting** or **Waiting**, check the room code. Some networks block
WebRTC connections, so try another network or a phone hotspot if needed.

## Development

Install 
- Node.js 22.12+
- npm

### Run locally

Run from the repository root:

```bash
npm install
npm run dev
```

Open the HTTPS address printed by Vite.

### Test

- **Desktop:** open two tabs as Expert and Novice with the same room code.
  Choose **Continue without AR** if prompted.
- **Phone:** join the development computer's Wi-Fi and open Vite's HTTPS network
  address. Only accept the certificate warning for your own server.

### Build for production

```bash
npm run build
```

Output is saved to `dist/`. Use `npm run preview` for a local preview.
Use the HTTPS development server or live demo for phone AR testing.

## Deployment

Pushing to `main` triggers the [GitHub Pages workflow](.github/workflows/deploy.yml),
which installs dependencies, builds the app, and deploys `dist/` to the live demo.
