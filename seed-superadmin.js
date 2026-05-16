const { Client } = require('pg');
const fetch = require('cross-fetch');
require('dotenv').config();

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

const superadmin = {
    email: 'superadmin.dev@gmail.com',
    password: 'superadmin@123',
    fullName: 'Dev SuperAdmin'
};

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAdminToken() {
    const params = new URLSearchParams();
    params.append('client_id', 'admin-cli');
    params.append('grant_type', 'password');
    params.append('username', process.env.KEYCLOAK_ADMIN_USER || 'admin');
    params.append('password', process.env.KEYCLOAK_ADMIN_PASSWORD || 'Admin123');

    const response = await fetch('http://localhost:8080/realms/master/protocol/openid-connect/token', {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!response.ok) {
        throw new Error('Failed to get Keycloak admin token');
    }

    const data = await response.json();
    return data.access_token;
}

async function seed() {
    console.log("🚀 Starting SuperAdmin seeding...");
    
    // 1. Wait for services to be ready
    let retries = 5; // Reduced for speed
    console.log("⏳ Waiting for Database and Keycloak to be ready...");
    
    while (retries > 0) {
        try {
            // Check Database
            const client = new Client(dbConfig);
            await client.connect();
            await client.end();
            console.log("✅ Database is ready.");
            
            // Check Keycloak - Using /realms/master which is more reliable than /health/live
            const kcRes = await fetch('http://localhost:8080/realms/master');
            if (kcRes.ok || kcRes.status === 200) {
                console.log("✅ Keycloak is ready.");
                break;
            }
            console.log(`⏳ Keycloak not ready yet (Status: ${kcRes.status}). Retrying...`);
        } catch (err) {
            console.log(`⏳ Waiting for services to be ready... (${retries} attempts left: ${err.message})`);
        }
        retries--;
        await wait(5000);
    }

    if (retries === 0) {
        console.error("❌ Services failed to become ready in time.");
        process.exit(1);
    }

    // 2. Keycloak Seeding
    let keycloakId = null;
    try {
        const token = await getAdminToken();
        
        // Check if user exists
        const searchRes = await fetch(`http://localhost:8080/admin/realms/gsttool/users?email=${superadmin.email}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await searchRes.json();
        
        if (users.length > 0) {
            keycloakId = users[0].id;
            console.log(`✅ SuperAdmin already exists in Keycloak (ID: ${keycloakId})`);
        } else {
            // Create user
            const createRes = await fetch(`http://localhost:8080/admin/realms/gsttool/users`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: superadmin.email,
                    email: superadmin.email,
                    firstName: 'Dev',
                    lastName: 'SuperAdmin',
                    enabled: true,
                    emailVerified: true,
                    credentials: [{
                        type: 'password',
                        value: superadmin.password,
                        temporary: false
                    }]
                })
            });

            if (createRes.status === 201) {
                const location = createRes.headers.get('location');
                keycloakId = location.split('/').pop();
                console.log(`✅ Created SuperAdmin in Keycloak (ID: ${keycloakId})`);
            } else {
                console.error("❌ Failed to create user in Keycloak:", await createRes.text());
            }
        }
    } catch (err) {
        console.error("⚠️ Keycloak seeding error:", err.message);
    }

    // 3. Database Seeding
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        // Ensure user exists in local DB
        const userCheck = await client.query("SELECT id FROM users WHERE email = $1", [superadmin.email]);
        
        if (userCheck.rows.length === 0) {
            const userId = require('crypto').randomUUID();
            await client.query(
                "INSERT INTO users (id, email, full_name, auth_provider_id, auth_provider_type, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())",
                [userId, superadmin.email, superadmin.fullName, keycloakId, 'KEYCLOAK', true]
            );
            console.log(`✅ Created SuperAdmin in PostgreSQL (ID: ${userId})`);
        } else {
            console.log("✅ SuperAdmin already exists in PostgreSQL");
            if (keycloakId) {
                await client.query("UPDATE users SET auth_provider_id = $1 WHERE email = $2", [keycloakId, superadmin.email]);
            }
        }
        
    } catch (err) {
        console.error("❌ Database seeding error:", err.message);
    } finally {
        await client.end();
    }

    console.log("🏁 Seeding complete.");
}

seed();
