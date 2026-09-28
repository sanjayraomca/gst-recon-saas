/**
 * One-off: re-encrypt stored GSTN portal passwords from OLD_GSTN_ENCRYPTION_KEY to GSTN_ENCRYPTION_KEY.
 *
 * Why: until now the services fell back to a hardcoded key (published in the source), and
 * docker-compose never passed GSTN_ENCRYPTION_KEY, so every stored password was encrypted
 * with that public default. After setting a new GSTN_ENCRYPTION_KEY, run this once so existing
 * ciphertexts are readable with the new key (and no longer with the public one).
 *
 * Usage (from the repo root, with the DB reachable on the host-mapped port):
 *   OLD_GSTN_ENCRYPTION_KEY='<old key>' GSTN_ENCRYPTION_KEY='<new key>' node scripts/reencrypt_gstn_passwords.js --dry-run
 *   OLD_GSTN_ENCRYPTION_KEY='<old key>' GSTN_ENCRYPTION_KEY='<new key>' node scripts/reencrypt_gstn_passwords.js
 *
 * DB connection: POSTGRES_MAIN_DB / POSTGRES_MAIN_USER / POSTGRES_MAIN_PASSWORD from .env,
 * host SEED_DB_HOST (default 127.0.0.1), port SEED_DB_PORT (default 5435).
 * Runs in one transaction; any row that fails to decrypt aborts the whole run.
 */
require('dotenv').config();
const crypto = require('crypto');
const { Client } = require('pg');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

const DRY_RUN = process.argv.includes('--dry-run');
const OLD_KEY = (process.env.OLD_GSTN_ENCRYPTION_KEY || '').trim();
const NEW_KEY = (process.env.GSTN_ENCRYPTION_KEY || '').trim();

if (!OLD_KEY || !NEW_KEY) {
    console.error('Both OLD_GSTN_ENCRYPTION_KEY and GSTN_ENCRYPTION_KEY must be set.');
    process.exit(1);
}
if (OLD_KEY === NEW_KEY) {
    console.error('OLD and NEW keys are identical; nothing to do.');
    process.exit(1);
}
if (NEW_KEY.length < 32) {
    console.error('GSTN_ENCRYPTION_KEY must be at least 32 characters.');
    process.exit(1);
}
if (!process.env.POSTGRES_MAIN_PASSWORD) {
    console.error('POSTGRES_MAIN_PASSWORD must be set.');
    process.exit(1);
}

const deriveKey = (masterKey, salt) => crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');

const decryptWith = (masterKey, data) => {
    const [saltB64, ivB64, encrypted, tagB64] = data.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(masterKey, Buffer.from(saltB64, 'base64')), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8');
};

const encryptWith = (masterKey, text) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(masterKey, salt), iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return `${salt.toString('base64')}:${iv.toString('base64')}:${encrypted}:${cipher.getAuthTag().toString('base64')}`;
};

// Both column names appear in the codebase (schema: gstin_pwd_encrypted; gstn-service writes gstn_password_encrypted)
const CANDIDATE_COLUMNS = ['gstin_pwd_encrypted', 'gstn_password_encrypted'];

async function main() {
    const client = new Client({
        host: process.env.SEED_DB_HOST || '127.0.0.1',
        port: parseInt(process.env.SEED_DB_PORT, 10) || 5435,
        database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
        user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
        password: process.env.POSTGRES_MAIN_PASSWORD
    });
    await client.connect();

    const { rows: cols } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'gstin_master' AND column_name = ANY($1)",
        [CANDIDATE_COLUMNS]
    );
    const columns = cols.map(r => r.column_name);
    console.log(`Columns found on gstin_master: ${columns.join(', ') || '(none)'}`);

    let total = 0;
    try {
        await client.query('BEGIN');
        for (const column of columns) {
            const { rows } = await client.query(
                `SELECT id, ${column} AS value FROM gstin_master WHERE ${column} IS NOT NULL AND ${column} <> ''`
            );
            console.log(`${column}: ${rows.length} encrypted value(s)`);
            for (const row of rows) {
                let plain;
                try {
                    plain = decryptWith(OLD_KEY, row.value);
                } catch (e) {
                    throw new Error(`Row ${row.id} (${column}) could not be decrypted with OLD_GSTN_ENCRYPTION_KEY — aborting, nothing changed.`);
                }
                const reencrypted = encryptWith(NEW_KEY, plain);
                // Sanity check before writing
                if (decryptWith(NEW_KEY, reencrypted) !== plain) {
                    throw new Error(`Round-trip check failed for row ${row.id}`);
                }
                if (!DRY_RUN) {
                    await client.query(`UPDATE gstin_master SET ${column} = $1 WHERE id = $2`, [reencrypted, row.id]);
                }
                total++;
            }
        }
        if (DRY_RUN) {
            await client.query('ROLLBACK');
            console.log(`DRY RUN: ${total} value(s) would be re-encrypted. No changes written.`);
        } else {
            await client.query('COMMIT');
            console.log(`Re-encrypted ${total} value(s).`);
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
