export function createInteractiveUpdateOperation() {
  return { phase: "check", dialogShown: false };
}

/** The check caller owns synchronous check errors; later updater errors show now. */
export function shouldShowUpdaterError(operation) {
  if (operation?.phase === "check") return false;
  if (operation?.phase === "download") operation.dialogShown = true;
  return true;
}

/** Attach a rejection owner before returning from an interactive update check. */
export function watchInteractiveDownload(promise, operation, { onError, onSettled }) {
  if (!promise || typeof promise.then !== "function") {
    operation.phase = "done";
    return false;
  }
  operation.phase = "download";
  void promise
    .catch(async (err) => {
      if (!operation.dialogShown) {
        operation.dialogShown = true;
        await onError(err);
      }
    })
    .finally(() => {
      operation.phase = "done";
      onSettled();
    });
  return true;
}
