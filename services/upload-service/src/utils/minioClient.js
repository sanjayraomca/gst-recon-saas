const Minio = require('minio');
const dotenv = require('dotenv');

dotenv.config();

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'minio',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
    secretKey: process.env.MINIO_ROOT_PASSWORD || 'MinioAdmin123'
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'gst-documents';

const initBucket = async () => {
    try {
        const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
        if (!bucketExists) {
            await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
            console.log(`Bucket ${BUCKET_NAME} created successfully.`);
        }
    } catch (err) {
        console.error('Error checking/creating bucket:', err);
    }
};

// Initialize bucket on startup
initBucket();

module.exports = {
    minioClient,
    BUCKET_NAME
};
