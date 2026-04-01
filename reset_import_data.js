const { Client } = require('pg');
const { Client: MinioClient } = require('minio');
require('dotenv').config();

const dbConfig = {
    // Override docker hostname with localhost for host execution
    host: (process.env.DB_HOST === 'postgres-main' ? '127.0.0.1' : process.env.DB_HOST) || '127.0.0.1',
    port: process.env.DB_PORT || 5435,
    database: process.env.DB_NAME || 'gst_recon',
    user: process.env.DB_USER || 'gstadmin',
    password: process.env.DB_PASSWORD || 'GstAdmin123',
};

const minioClient = new MinioClient({
    endPoint: (process.env.MINIO_ENDPOINT === 'minio' ? '127.0.0.1' : process.env.MINIO_ENDPOINT) || '127.0.0.1',
    port: parseInt(process.env.MINIO_PORT || '9090'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'MinioAdmin123'
});
const bucketName = process.env.MINIO_BUCKET_NAME || 'gst-documents';

const tablesToTruncate = [

    'gstr_import_master',
    'gstr_import_logs',
    'gstr_2b_b2b_invoices',
    'gstr_2b_b2ba_invoices',
    'gstr_2b_cdnr',
    'gstr_2b_cdnra',
    'gstr_2b_impg',
    'gstr_2b_isd',
    'normalized_gstr2b_invoices',
    'gstr_2a_b2b_invoices',
    'gstr_2a_b2ba_invoices',
    'gstr_2a_cdnr',
    'gstr_2a_cdnra',
    'gstr_2a_impg',
    'gstr_2a_isd',
    'normalized_gstr2a_invoices',
    'purchase_items',
    'purchase_vouchers',
    'sales_invoice_items',
    'sales_invoices',
    'reconciliation_results',
    'reconciliation_status',
    'reconciliation_status_gst2a_vs_book',
    'reconciliation_runs',
    'supplier_master',
    'customer_master',
    'tax_periods',
    'financial_years'
];

async function clearMinioObjects() {
    console.log(`[MinIO] Looking for objects in bucket: ${bucketName}`);
    return new Promise((resolve, reject) => {
        const objectsList = [];
        const stream = minioClient.listObjects(bucketName, '', true);

        stream.on('data', obj => objectsList.push(obj.name));
        stream.on('error', err => reject(err));
        stream.on('end', async () => {
            if (objectsList.length === 0) {
                console.log('[MinIO] Bucket is already empty.');
                return resolve();
            }
            console.log(`[MinIO] Found ${objectsList.length} objects. Removing them...`);
            try {
                await minioClient.removeObjects(bucketName, objectsList);
                console.log('[MinIO] Successfully removed all objects.');
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function runCleanup() {
    console.log("==================================================");
    console.log("Starting Targeted Data Cleanup (DB & Minio)...");
    console.log("==================================================");

    const client = new Client(dbConfig);

    try {
        console.log("[DB] Connecting to PostgreSQL...");
        await client.connect();

        console.log("\n[DB] Truncating requested tables (CASCADE)...");
        // We use CASCADE so we don't have to worry about the exact order
        const queryList = tablesToTruncate.map(t => `${t}`).join(', ');
        const truncateSql = `TRUNCATE TABLE ${queryList} CASCADE;`;

        console.log(`[DB] Executing: ${truncateSql}`);
        await client.query(truncateSql);

        console.log("[DB] All requested tables successfully truncated.");

        console.log("\n[MinIO] Connecting to MinIO to clear files...");
        try {
            const exists = await minioClient.bucketExists(bucketName);
            if (exists) {
                await clearMinioObjects();
            } else {
                console.log(`[MinIO] Bucket ${bucketName} does not exist, skipping.`);
            }
        } catch (minioErr) {
            console.error("[MinIO] Error clearing MinIO:", minioErr.message);
            console.log("[MinIO] Ensure minio is accessible via localhost:9000 if running this script directly from the host.");
        }

        console.log("\n==================================================");
        console.log("✅ Cleanup Complete! You are ready for a fresh import test.");
        console.log("==================================================");

    } catch (dbErr) {
        console.error("\n❌ Database Cleanup Failed:", dbErr.message);
    } finally {
        await client.end();
    }
}

runCleanup();
