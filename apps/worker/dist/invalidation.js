"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVALIDATOR_GROUP = exports.INVALIDATION_TOPICS = void 0;
exports.invalidationKeys = invalidationKeys;
exports.processInvalidation = processInvalidation;
const outbox_1 = require("./outbox");
exports.INVALIDATION_TOPICS = ['price.changed', 'stock.changed'];
exports.INVALIDATOR_GROUP = 'cache-invalidator';
function invalidationKeys(topic, key, body) {
    if (!body || !key)
        return null;
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch {
        return null;
    }
    if (!payload || typeof payload !== 'object' || !('event_id' in payload) || typeof payload.event_id !== 'string') {
        return null;
    }
    if (!(0, outbox_1.toMessage)({ id: payload.event_id, topic, key, payload }))
        return null;
    return [`product:${key}`, `pstats:${key}`, `lock:product:${key}`];
}
async function processInvalidation(job) {
    let resume;
    try {
        if (job.keys) {
            let attempt = 0;
            while (!job.signal.aborted) {
                try {
                    await job.invalidate(job.keys);
                    break;
                }
                catch {
                    resume ??= job.pause();
                    await job.wait(++attempt);
                }
            }
        }
        if (job.signal.aborted)
            return 'stopped';
        await job.commit();
        return job.keys ? 'success' : 'invalid';
    }
    finally {
        if (!job.signal.aborted)
            resume?.();
    }
}
