import { createElement, ArrowUp, Camera, Check, ChevronsUp, Circle, Crosshair, Eye, EyeOff, Pin, RotateCcw, Trash2, Undo2, X } from "lucide";

function markup(node) {
  return createElement(node, {
    class: "icon", width: 20, height: 20, "stroke-width": 2,
    "aria-hidden": "true", focusable: "false",
  }).outerHTML;
}

export const CHECK_ICON = markup(Check);
export const WAIT_ICON = markup(Circle);
export const FIND_ICON = markup(Crosshair);
export const EYE_ICON = markup(Eye);
export const EYE_OFF_ICON = markup(EyeOff);
export const PIN_ICON = markup(Pin);
export const TRASH_ICON = markup(Trash2);
export const UNDO_ICON = markup(Undo2);
export const CLOSE_ICON = markup(X);
export const CAMERA_ICON = markup(Camera);
export const RESET_ICON = markup(RotateCcw);
export const ARROW_ICON = markup(ArrowUp);
export const STEP_ICON = markup(ChevronsUp);

export function setIconButton(button, image, label) {
  button.type = "button";
  button.classList.add("icon-button");
  button.innerHTML = image;
  button.setAttribute("aria-label", label);
  button.title = label;
}
