/* ============================================
   Minimal .env loader — zero dependencies.
   Keeps JWT_SECRET (and other settings) stable
   across restarts, so nobody gets logged out
   mid-demo.
   ============================================ */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

module.exports = function loadEnv() {
    // Allows a hermetic test run to ignore a developer's .env entirely.
    if (process.env.NO_DOTENV) return;
    if (!fs.existsSync(ENV_FILE)) return;

    try {
        const raw = fs.readFileSync(ENV_FILE, 'utf8');

        raw.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();

            // Skip blanks and comments
            if (!trimmed || trimmed.startsWith('#')) return;

            const eq = trimmed.indexOf('=');
            if (eq === -1) return;

            const key = trimmed.slice(0, eq).trim();
            if (!key) return;

            let value = trimmed.slice(eq + 1).trim();

            // Strip matched surrounding quotes
            if (value.length >= 2 &&
                ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'")))) {
                value = value.slice(1, -1);
            }

            // Never override a value already present in the real environment
            if (!(key in process.env)) {
                process.env[key] = value;
            }
        });
    } catch (error) {
        console.error('Could not read .env:', error.message);
    }
};
