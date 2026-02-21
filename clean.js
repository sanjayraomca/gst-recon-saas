const { execSync } = require('child_process');

console.log("==========================================");
console.log("Cleaning Database, Keycloak, and Minio...");
console.log("==========================================");

try {
    // Stop all containers and remove all persistent volumes (-v flag)
    // This will wipe the PostgreSQL data (Main, Keycloak, Kong) and Minio data.
    console.log("Stopping containers and removing nested volumes...");
    execSync('docker compose down -v', { stdio: 'inherit', cwd: __dirname });

    console.log("\n==========================================");
    console.log("Starting a fresh environment...");
    console.log("==========================================");

    // Start everything back up with fresh builds to apply latest code changes
    execSync('docker compose build --no-cache && docker compose up -d', { stdio: 'inherit', cwd: __dirname });

    console.log("\n==========================================");
    console.log("✅ Clean complete! All databases and storage are wiped and restarted.");
    console.log("==========================================");
} catch (error) {
    console.error("❌ An error occurred while trying to clean the environment.", error.message);
}
