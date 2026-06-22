const EventEmitter = require('events');

class ProgressEmitter extends EventEmitter {
    async emitProgress(uploadId, progress, message, isError = false) {
        if (!uploadId) return;
        this.emit('progress', { uploadId, progress, message, error: isError });
        // Yield the event loop to ensure SSE flushes to the network
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

// Singleton event emitter for upload progress tracking
const progressEmitter = new ProgressEmitter();

// Allow multiple concurrent uploads without warnings
progressEmitter.setMaxListeners(100);

module.exports = progressEmitter;
