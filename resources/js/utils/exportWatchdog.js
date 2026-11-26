// Bulk USB exports may exceed a minute while still making steady progress.
// Bound the idle wait rather than the entire export duration.
export function createExportWatchdog(onTimeout, clock = {
  // Keep the browser global as the receiver of its native timer methods.
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: timerId => globalThis.clearTimeout(timerId),
}) {
  let timer = null, duration = 0, message = '';
  function stop() { if (timer !== null) clock.clearTimeout(timer); timer = null; }
  function arm() {
    stop();
    timer = clock.setTimeout(() => { timer = null; onTimeout(new Error(message)); }, duration);
  }
  return {
    start(ms, text) { duration = ms; message = text; arm(); },
    progress() { if (timer !== null) arm(); },
    stop,
  };
}
