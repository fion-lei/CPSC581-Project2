import { showToast, hideToast } from "./hud.js";
import { PROBLEMS, fixText } from "./pin-labels.js";
import { FIND_ICON, CHECK_ICON } from "./icons.js";

const TOAST_MS = 10000;

// Novice: the newest pin from the expert in the toast slot. Its fix, then a find
// button and a check. Hides after 10 s; the drawer keeps every pin.
// onAck(id) confirms the pin; onFind(id | null) selects the pin being found.
export function createPinToast({ onAck, onFind }) {
  let current = null;
  let finding = false;
  let rendering = false; // re-rendering our own toast doesn't close it

  function render() {
    const pin = current;
    // "Overhang · pin 4"; a plain "Look here" pin has only its number
    const body = pin.fix ? `${PROBLEMS[pin.problem].name} · pin ${pin.no}` : `Pin ${pin.no}`;
    const actions = [
      { icon: FIND_ICON, label: `Find pin ${pin.no}`, onClick: find },
      { icon: CHECK_ICON, label: `Confirm pin ${pin.no}`, primary: true, onClick: () => onAck(pin.id) },
    ];
    rendering = true;
    // Finding: no timer, so the check stays ready
    showToast(fixText(pin), body, finding ? 0 : TOAST_MS, { actions, timer: !finding, onClose });
    rendering = false;
  }

  // Timed out, confirmed, or another toast took the slot
  function onClose() {
    if (rendering) return;
    current = null;
    if (finding) {
      finding = false;
      onFind(null);
    }
  }

  // The pin grows and the others dim; off screen, its edge arrow points the way
  function find() {
    finding = true;
    onFind(current.id);
    render();
  }

  return {
    // A new or changed pin replaces whatever the toast showed
    show(pin) {
      if (current && finding) onFind(null);
      current = pin;
      finding = false;
      render();
    },
    // Close it if it shows this pin (or any pin, without an id)
    close(id) {
      if (current && (id === undefined || current.id === id)) hideToast();
    },
  };
}
