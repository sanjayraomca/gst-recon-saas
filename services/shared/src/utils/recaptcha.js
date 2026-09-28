/**
 * Server-side Google reCAPTCHA (v2 checkbox) verification for public sign-up endpoints.
 *
 * Fails CLOSED: if RECAPTCHA_SECRET_KEY is not configured, sign-up is refused rather
 * than silently skipping the check (which is what used to happen, so the captcha did
 * nothing at all). For local development without keys, set RECAPTCHA_DISABLED=true
 * explicitly, or use Google's public test key pair (see .env.example).
 */
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
const verifyRecaptcha = async (token, remoteIp) => {
    if (String(process.env.RECAPTCHA_DISABLED).toLowerCase() === 'true') {
        console.warn('[recaptcha] RECAPTCHA_DISABLED=true — skipping verification (never use this in production).');
        return { ok: true };
    }

    const secret = (process.env.RECAPTCHA_SECRET_KEY || '').trim();
    if (!secret) {
        console.error('[recaptcha] RECAPTCHA_SECRET_KEY is not set — refusing sign-up. Set it, or RECAPTCHA_DISABLED=true for local dev.');
        return { ok: false, status: 503, message: 'Sign-up is temporarily unavailable (captcha is not configured). Please contact support.' };
    }

    if (!token || typeof token !== 'string') {
        return { ok: false, status: 400, message: 'Please complete the "I\'m not a robot" check.' };
    }

    try {
        const body = new URLSearchParams({ secret, response: token });
        if (remoteIp) body.append('remoteip', remoteIp);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let data;
        try {
            const resp = await fetch(VERIFY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
                signal: controller.signal,
            });
            data = await resp.json();
        } finally {
            clearTimeout(timer);
        }

        if (!data || data.success !== true) {
            console.warn('[recaptcha] verification failed:', data && data['error-codes']);
            const codes = (data && data['error-codes']) || [];
            if (codes.includes('invalid-input-secret')) {
                return { ok: false, status: 503, message: 'Sign-up is temporarily unavailable (captcha is misconfigured). Please contact support.' };
            }
            if (codes.includes('timeout-or-duplicate')) {
                return { ok: false, status: 400, message: 'The captcha expired. Please tick "I\'m not a robot" again.' };
            }
            return { ok: false, status: 400, message: 'Captcha verification failed. Please try again.' };
        }
        return { ok: true };
    } catch (err) {
        console.error('[recaptcha] could not reach Google:', err.message);
        return { ok: false, status: 502, message: 'Could not verify the captcha right now. Please try again in a moment.' };
    }
};

module.exports = { verifyRecaptcha };
