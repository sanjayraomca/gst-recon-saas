const { connect, StringCodec } = require('nats');

let nc;
const sc = StringCodec();

const connectNATS = async () => {
    try {
        const natsUrl = process.env.NATS_URL || 'nats://nats:4222';
        nc = await connect({ servers: natsUrl });
        console.log(`Connected to NATS at ${natsUrl}`);
        return nc;
    } catch (error) {
        console.error('Error connecting to NATS:', error);
        throw error;
    }
};

const getNATS = () => {
    if (!nc) {
        throw new Error('NATS not initialized');
    }
    return nc;
};

module.exports = {
    connectNATS,
    getNATS,
    sc
};
