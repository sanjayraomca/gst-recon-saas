const { connect, StringCodec } = require('nats');

let nc;
const sc = StringCodec();

const connectNats = async () => {
    try {
        const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
        nc = await connect({ servers: natsUrl });
        console.log(`Connected to NATS at ${natsUrl}`);
    } catch (error) {
        console.error('Error connecting to NATS:', error);
        throw error;
    }
};

const publishEvent = (subject, data) => {
    if (!nc) {
        console.error('NATS not connected. Cannot publish event.');
        return;
    }
    nc.publish(subject, sc.encode(JSON.stringify(data)));
    console.log(`Event published to ${subject}`);
};

module.exports = {
    connectNats,
    publishEvent
};
