const { execSync } = require('child_process');
const { Client } = require('pg');
const fetch = require('cross-fetch');
require('dotenv').config();

console.log("==========================================");
console.log("Cleaning Database, Keycloak, and Minio....");
console.log("==========================================");

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port for postgres-main
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    try {
        console.log("Stopping containers and removing nested volumes...");
        try {
            execSync('docker compose down -v', { stdio: 'inherit', cwd: __dirname });
        } catch (e) {
            console.warn("⚠️ Docker compose down returned an error, forcing container removal...", e.message);
        }

        // Force remove containers to avoid naming conflicts
        console.log("Ensuring no conflicting containers remain...");
        try {
            execSync('docker rm -f gst-frontend gst-workspace-service gst-tenant-service gst-gstn-service gst-upload-service gst-report-service gst-notification-service gst-json-import-service gst-external-api-service gst-postgres-main gst-postgres-keycloak gst-postgres-kong gst-traefik gst-nats gst-minio gst-mailhog gst-kong gst-keycloak gst-adminer 2>/dev/null || true');
        } catch (e) {
            // Ignore
        }

        console.log("\n==========================================");
        console.log("Starting a fresh environment...");
        console.log("==========================================");

        // Start everything back up with fresh builds to apply latest code changes
        execSync('docker compose up -d --build --force-recreate', { stdio: 'inherit', cwd: __dirname });

        console.log("\n==========================================");
        console.log("⏳ Waiting for Database to be ready to accept connections...");
        console.log("==========================================");

        let dbReady = false;
        for (let i = 0; i < 30; i++) {
            try {
                const client = new Client(dbConfig);
                await client.connect();
                await client.end();
                dbReady = true;
                console.log("✅ Database is ready.");
                break;
            } catch (err) {
                console.log(`⏳ Database not ready yet (attempt ${i + 1}/30)...`);
                await wait(2000);
            }
        }

        if (!dbReady) {
            throw new Error("Timeout waiting for postgres-main database to start.");
        }

        console.log("\n==========================================");
        console.log("⚙️ Applying database migrations...");
        console.log("==========================================");
        execSync('node scratch/apply_migrations.js', { stdio: 'inherit', cwd: __dirname });

        console.log("\n==========================================");
        console.log("👤 Seeding SuperAdmin user...");
        console.log("==========================================");
        execSync('node seed-superadmin.js', { stdio: 'inherit', cwd: __dirname });

        console.log("\n==========================================");
        console.log("🔑 Seeding API client keys...");
        console.log("==========================================");
        execSync('node scratch/seed_api_client_v2.js', { stdio: 'inherit', cwd: __dirname });
        execSync('node scratch/seed_api_client_gsp_db.js', { stdio: 'inherit', cwd: __dirname });

        console.log("\n==========================================");
        console.log("✅ Clean complete! All databases and storage are wiped, restarted, migrated, and seeded.");
        console.log("==========================================");
    } catch (error) {
        console.error("❌ An error occurred while trying to clean the environment:", error.message);
    }
}

main();
