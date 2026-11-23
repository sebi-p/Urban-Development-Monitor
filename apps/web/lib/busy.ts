/**
 * Marks the page as loading new results (`<html data-busy>`): globals.css then shows the progress
 * bar under the app bar and fades what is about to change (`data-busy-fade`, `.busy-spinner`).
 * Both appear only after 150 ms, so quick updates don't flicker.
 */
export function setBusy(on: boolean) {
  if (on) document.documentElement.dataset.busy = "";
  else delete document.documentElement.dataset.busy;
}
