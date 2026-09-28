/**
 * Required-secret helpers.
 *
 * Secrets must come from the environment. There are deliberately NO fallback
 * values: a missing or placeholder secret must stop the service instead of
 * silently running with a value that is published in the source code.
 */
const KNOWN_PLACEHOLDERS = new Set([
    'change-this-secret-in-production',
    'CHANGE_THIS_IN_PRODUCTION_USE_ENV_VAR_32CHARS_MIN',
    'admin-api-secret-change-in-production'
]);

const MIN_SECRET_LENGTH = 32;

/**
 * @param {string} name - environment variable name
 * @returns {string|null} a human-readable problem, or null when the value is acceptable
 */
const getSecretProblem = (name) => {
    const value = (process.env[name] || '').trim();
    if (!value) return `${name} is not set`;
    if (KNOWN_PLACEHOLDERS.has(value) || value.toUpperCase().startsWith('CHANGE_ME')) {
        return `${name} is still set to a placeholder value`;
    }
    if (value.length < MIN_SECRET_LENGTH) {
        return `${name} must be at least ${MIN_SECRET_LENGTH} characters long`;
    }
    return null;
};

/**
 * Returns the secret or throws. Use at the point of use.
 * @param {string} name
 * @returns {string}
 */
const getRequiredSecret = (name) => {
    const problem = getSecretProblem(name);
    if (problem) {
        throw new Error(`Server configuration error: ${problem}`);
    }
    return process.env[name].trim();
};

/**
 * Call once at service start-up. Exits the process if any secret is missing/weak,
 * so a misconfigured deployment fails loudly instead of running insecurely.
 * @param {string[]} names
 * @param {string} serviceName
 */
const assertRequiredSecrets = (names, serviceName) => {
    const problems = names.map(getSecretProblem).filter(Boolean);
    if (problems.length > 0) {
        problems.forEach((p) => console.error(`[${serviceName}] FATAL: ${p}`));
        console.error(`[${serviceName}] Refusing to start. Generate values with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`);
        process.exit(1);
    }
};

module.exports = {
    getSecretProblem,
    getRequiredSecret,
    assertRequiredSecrets,
    MIN_SECRET_LENGTH
};
