const { connect, StringCodec } = require('nats');

let nc = null;
const sc = StringCodec();

const connectNats = async (retries = 10, delay = 1000) => {
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';

    for (let i = 0; i < retries; i++) {
        try {
            nc = await connect({
                servers: natsUrl,
                maxReconnectAttempts: -1, // Infinite reconnects once connected
                waitOnFirstConnect: true, // Wait for first connection
                reconnectTimeWait: 1000
            });
            console.log(`Connected to NATS at ${natsUrl}`);
            return nc;
        } catch (err) {
            console.error(`Error connecting to NATS (attempt ${i + 1}/${retries}):`, err.message);
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 10000); // Cap delay at 10s
        }
    }
};

const publishMessage = (subject, data) => {
    if (!nc) {
        console.error('NATS not connected');
        return;
    }
    nc.publish(subject, sc.encode(JSON.stringify(data)));
};

const subscribeToSubject = (subject, callback) => {
    if (!nc) {
        console.error('NATS not connected');
        return;
    }
    const sub = nc.subscribe(subject);
    (async () => {
        for await (const m of sub) {
            const data = JSON.parse(sc.decode(m.data));
            callback(data, m);
        }
    })();
};

const getNatsClient = () => nc;

module.exports = {
    connectNats,
    publishMessage,
    subscribeToSubject,
    getNatsClient
};
