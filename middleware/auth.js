const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const security = require('../config/security');
const db = require('../config/db');

// Secret comes from the environment (or a per-boot random in dev).
const JWT_SECRET = security.resolveJwtSecret();
const JWT_EXPIRES = '7d';

// Hash password
function hashPassword(password) {
    return bcrypt.hashSync(password, 12);
}

// Compare password
function comparePassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

// Generate JWT. `sv` is the user's session version; a password change bumps
// it, which invalidates every token issued before the change.
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role, sv: user.token_version || 0 },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

// Reject a token whose session version no longer matches the user's.
function tokenIsCurrent(decoded) {
    const current = db.getUserById(decoded.id);
    return !!current && (current.token_version || 0) === (decoded.sv || 0);
}

// Verify JWT middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader);

    if (!match) {
        return res.status(401).json({ error: 'No token provided' });
    }

    let decoded;
    try {
        decoded = jwt.verify(match[1], JWT_SECRET);
    } catch (error) {
        // Never distinguish "expired" from "malformed" — same generic message
        return res.status(401).json({ error: 'Invalid token' });
    }

    if (!tokenIsCurrent(decoded)) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    next();
}

// Role-based access control
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

module.exports = {
    tokenIsCurrent,
    hashPassword,
    comparePassword,
    generateToken,
    authMiddleware,
    requireRole,
    JWT_SECRET
};
