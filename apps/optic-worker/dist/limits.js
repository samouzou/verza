"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIC_WORKER_PRACTICAL_CAP = exports.OPTIC_MAX_SAVED_PER_RUN = void 0;
exports.urlPoolCap = urlPoolCap;
exports.vetDelayMs = vetDelayMs;
exports.workerSaveTarget = workerSaveTarget;
/** Per-batch save target for the Cloud Run worker. */
exports.OPTIC_MAX_SAVED_PER_RUN = 100;
/** Worker runs are still bounded by HTTP/Firestore dispatch (~9 min). */
exports.OPTIC_WORKER_PRACTICAL_CAP = 25;
/** Unique profile URLs to consider before vetting. */
function urlPoolCap(targetSaved) {
    const t = Math.max(1, targetSaved);
    return Math.min(400, Math.max(t * 8, t + 25));
}
/** Pause between profile reviews — shorter for large batches. */
function vetDelayMs(targetSaved) {
    if (targetSaved >= 50)
        return 200;
    if (targetSaved >= 25)
        return 300;
    if (targetSaved >= 12)
        return 450;
    return 650;
}
/** Effective save target for one worker HTTP run. */
function workerSaveTarget(requested) {
    const t = Math.max(1, Math.floor(requested));
    return Math.min(exports.OPTIC_MAX_SAVED_PER_RUN, exports.OPTIC_WORKER_PRACTICAL_CAP, t);
}
