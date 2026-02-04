const { connect, StringCodec } = require('nats');

let nc = null;
const sc = StringCodec();

const connectNats = async () => {
    try {
        const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
        nc = await connect({ servers: natsUrl });
        console.log(`Connected to NATS at ${natsUrl}`);
        return nc;
    } catch (err) {
        console.error('Error connecting to NATS:', err);
        throw err;
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
