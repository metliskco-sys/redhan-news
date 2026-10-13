const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const security = require('../config/security');

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

// Generate JWT
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

// Verify JWT middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader);

    if (!match) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(match[1], JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        // Never distinguish "expired" from "malformed" — same generic message
        return res.status(401).json({ error: 'Invalid token' });
    }
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
    hashPassword,
    comparePassword,
    generateToken,
    authMiddleware,
    requireRole,
    JWT_SECRET
};
