/**
 * ST-AutoPulse Poll Worker
 * Web Worker for background-safe polling.
 * Browser tabs throttle setInterval to >=1min in background,
 * but Web Workers are exempt from this throttling.
 */

let intervalId = null;

self.onmessage = function (e) {
    const { command, interval } = e.data;

    switch (command) {
        case 'start':
            if (intervalId) clearInterval(intervalId);
            const ms = interval || 5000;
            intervalId = setInterval(() => {
                self.postMessage({ type: 'tick', timestamp: Date.now() });
            }, ms);
            self.postMessage({ type: 'started', interval: ms });
            break;

        case 'stop':
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            self.postMessage({ type: 'stopped' });
            break;

        case 'ping':
            self.postMessage({ type: 'pong', timestamp: Date.now() });
            break;
    }
};
