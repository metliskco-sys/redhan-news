/**
 * Storage facade.
 *
 * Uses Postgres when DATABASE_URL is set, otherwise falls back to the JSON
 * file so the project still runs with no database configured (local dev,
 * CI).
 *
 * Both backends expose the same method names. The Postgres ones are async,
 * so every caller must await them — routes/frontend.test.js enforce that.
 */
if (process.env.DATABASE_URL) {
    const { pg } = require('./database-pg');
    module.exports = pg;
} else {
    module.exports = require('./database');
}
