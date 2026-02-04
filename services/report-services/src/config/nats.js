const { connect, StringCodec } = require('nats');

let nc = null;
const sc = StringCodec();

const connectNATS = async () => {
    try {
        const natsUrl = process.env.NATS_URL || 'nats://nats:4222';
        nc = await connect({ servers: natsUrl });
        console.log(`Report Service connected to NATS at ${natsUrl}`);
        return nc;
    } catch (error) {
        console.error('Error connecting to NATS:', error);
        process.exit(1);
    }
};

const getNATS = () => {
    if (!nc) {
        throw new Error('NATS not connected');
    }
    return nc;
};

module.exports = { connectNATS, getNATS, sc };
