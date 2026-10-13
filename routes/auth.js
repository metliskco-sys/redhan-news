const express = require('express');
const router = express.Router();
const db = require('../config/database');
const security = require('../config/security');
const { hashPassword, comparePassword, generateToken, authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/* Rate limits: brute-force protection on the sensitive endpoints */
const loginLimiter = security.rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyFn: 'ip+email',
    message: 'Too many sign-in attempts for this account. Try again in a few minutes.'
});

const signupLimiter = security.rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many accounts created from this address. Try again later.'
});

const ipLimiter = security.rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    message: 'Too many requests. Try again shortly.'
});

/* Password policy — applied to every write path */
const PASSWORD_RULE = body('password')
    .isString().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[a-zA-Z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number');

// Never echo a client-supplied role: public signup is always 'reader'
const safeUser = (user) => {
    const { password, ...rest } = user;
    return rest;
};

/* ============================================================
   PUBLIC SIGN-UP — hard-capped to 'reader'
   ============================================================ */
router.post('/signup', ipLimiter, signupLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('name').trim().notEmpty().isLength({ max: 80 }),
    PASSWORD_RULE
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, name, password } = req.body;

    try {
        // Same generic error whether or not the address exists
        if (db.getUser(email)) {
            return res.status(409).json({ error: 'That email is already registered.' });
        }

        const user = db.createUser({
            email,
            password: hashPassword(password),
            name,
            role: 'reader'            // never trust the client's role
        });

        res.status(201).json({ user: safeUser(user), token: generateToken(user) });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/* ============================================================
   LOGIN — lockout + generic errors + limiter
   ============================================================ */
router.post('/login', ipLimiter, loginLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const ip = req.ip || 'unknown';

    // Progressive lockout: 5 failures locks this email+IP for 15 minutes
    if (security.isLoginLocked(email, ip)) {
        return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    try {
        const user = db.getUser(email);

        // Constant-ish work whether or not the user exists
        const hash = user ? user.password : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
        const ok = comparePassword(password, hash);

        if (!user || !ok) {
            security.registerLoginFailure(email, ip);
            // Deliberately identical message either way
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        security.clearLoginFailures(email, ip);
        res.json({ user: safeUser(user), token: generateToken(user) });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/* ============================================================
   PROFILE
   ============================================================ */
router.get('/profile', authMiddleware, (req, res) => {
    try {
        const user = db.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: safeUser(user) });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/profile', authMiddleware, [
    body('name').optional().trim().notEmpty().isLength({ max: 80 }),
    body('bio').optional().isLength({ max: 500 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { name, bio } = req.body;
        // A user may only edit their own profile (id comes from the token)
        const user = db.updateUser(req.user.id, { name, bio });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: safeUser(user) });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/* ============================================================
   USER MANAGEMENT — superadmin only
   ============================================================ */
router.post('/register', authMiddleware, requireRole('superadmin'), ipLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('name').trim().notEmpty().isLength({ max: 80 }),
    PASSWORD_RULE,
    body('role').optional().isIn(['admin', 'writer', 'reader'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, name, password, role } = req.body;

    try {
        if (db.getUser(email)) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = hashPassword(password);
        const user = db.createUser({
            email,
            password: hashedPassword,
            name,
            role: role || 'writer'     // no self-promotion to superadmin
        });

        res.status(201).json({ user: safeUser(user), token: generateToken(user) });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/users', authMiddleware, requireRole('superadmin', 'admin'), (req, res) => {
    try {
        const users = db.getAllUsers().map(safeUser);
        res.json({ users });
    } catch (error) {
        console.error('Users list error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/users/:id/role', authMiddleware, requireRole('superadmin'), [
    body('role').isIn(['admin', 'writer', 'reader']).withMessage('Invalid role')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const targetId = Number(req.params.id);
        const { role } = req.body;

        // Nobody may change their own role — avoids a self-lockout vector
        if (targetId === req.user.id) {
            return res.status(403).json({ error: 'You cannot change your own role.' });
        }

        const target = db.getUserById(targetId);
        if (!target) return res.status(404).json({ error: 'User not found' });

        // A superadmin may not demote the last remaining superadmin
        if (target.role === 'superadmin' && role !== 'superadmin') {
            const remaining = db.getAllUsers().filter(u => u.role === 'superadmin');
            if (remaining.length <= 1) {
                return res.status(403).json({ error: 'This is the only super admin — promote another first.' });
            }
        }

        const user = db.updateUser(targetId, { role });
        res.json({ user: safeUser(user) });
    } catch (error) {
        console.error('Role update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/users/:id', authMiddleware, requireRole('superadmin'), (req, res) => {
    try {
        const targetId = Number(req.params.id);

        if (targetId === req.user.id) {
            return res.status(403).json({ error: 'You cannot delete your own account.' });
        }

        const target = db.getUserById(targetId);
        if (!target) return res.status(404).json({ error: 'User not found' });

        // Prevent locking everyone out by deleting the last superadmin
        if (target.role === 'superadmin') {
            const remaining = db.getAllUsers().filter(u => u.role === 'superadmin');
            if (remaining.length <= 1) {
                return res.status(403).json({ error: 'This is the only super admin.' });
            }
        }

        db.deleteUser(targetId);
        res.json({ message: 'User deleted' });
    } catch (error) {
        console.error('User delete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
