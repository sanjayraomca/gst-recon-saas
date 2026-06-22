const crypto = require('crypto');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Get encryption key from environment or generate a secure default
// IMPORTANT: In production, this MUST be set via environment variable
const ENCRYPTION_KEY = process.env.GSTN_ENCRYPTION_KEY || 'CHANGE_THIS_IN_PRODUCTION_USE_ENV_VAR_32CHARS_MIN';

/**
 * Derives a cryptographic key from the master key using PBKDF2
 * @param {string} masterKey - The master encryption key
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} - Derived key
 */
function deriveKey(masterKey, salt) {
    return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted data in format: salt:iv:encrypted:authTag (all base64 encoded)
 */
function encrypt(text) {
    if (!text) return null;

    try {
        // Generate random salt and IV
        const salt = crypto.randomBytes(SALT_LENGTH);
        const iv = crypto.randomBytes(IV_LENGTH);

        // Derive key from master key and salt
        const key = deriveKey(ENCRYPTION_KEY, salt);

        // Create cipher
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        // Encrypt the text
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        // Get authentication tag
        const authTag = cipher.getAuthTag();

        // Combine salt, IV, encrypted data, and auth tag
        // Format: salt:iv:encrypted:authTag (all base64 encoded)
        return `${salt.toString('base64')}:${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt data');
    }
}

/**
 * Decrypts data encrypted with the encrypt function
 * @param {string} encryptedData - Encrypted data in format: salt:iv:encrypted:authTag
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedData) {
    if (!encryptedData) return null;

    try {
        // Split the encrypted data
        const parts = encryptedData.split(':');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted data format');
        }

        const salt = Buffer.from(parts[0], 'base64');
        const iv = Buffer.from(parts[1], 'base64');
        const encrypted = parts[2];
        const authTag = Buffer.from(parts[3], 'base64');

        // Derive the same key using salt
        const key = deriveKey(ENCRYPTION_KEY, salt);

        // Create decipher
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        // Decrypt the text
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt data');
    }
}

/**
 * Validates if the encryption key is properly configured
 * @returns {boolean} - True if key is valid
 */
function validateEncryptionKey() {
    if (!ENCRYPTION_KEY || ENCRYPTION_KEY === 'CHANGE_THIS_IN_PRODUCTION_USE_ENV_VAR_32CHARS_MIN') {
        console.warn('WARNING: Using default encryption key. Set GSTN_ENCRYPTION_KEY environment variable in production!');
        return false;
    }
    if (ENCRYPTION_KEY.length < 32) {
        console.error('ERROR: Encryption key must be at least 32 characters long');
        return false;
    }
    return true;
}

// Validate key on module load
validateEncryptionKey();

module.exports = {
    encrypt,
    decrypt,
    validateEncryptionKey
};
