const EventEmitter = require('events');

class ProgressEmitter extends EventEmitter {
    async emitProgress(runId, progress, message, isError = false) {
        if (!runId) return;
        this.emit('progress', { runId, progress, message, error: isError });
        // Yield the event loop to ensure SSE flushes to the network
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

// Singleton event emitter for reconciliation progress tracking
const progressEmitter = new ProgressEmitter();

// Allow multiple concurrent runs without warnings
progressEmitter.setMaxListeners(100);

module.exports = progressEmitter;
