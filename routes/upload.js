const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const security = require('../config/security');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        // The extension is decided by the *detected* type later; use a neutral
        // name here and rename after signature verification.
        const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED.has(file.mimetype)) {
            return cb(new Error('Only JPEG, PNG, WebP, AVIF or GIF images are allowed.'));
        }
        cb(null, true);
    }
});

// @route   POST /api/upload/image
// @desc    Upload a single cover image (any editorial role)
router.post('/image', authMiddleware, requireRole('superadmin', 'admin', 'writer'), (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? 'Image is too large (8 MB maximum).'
                : (err.message || 'Upload failed.');
            return res.status(400).json({ error: message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No image file received.' });
        }

        try {
            // Verify the *content*, not the declared MIME type or filename:
            // a PHP/JS payload renamed .png must never be stored.
            const buffer = fs.readFileSync(req.file.path);
            const detected = security.detectImageType(buffer);

            if (!detected) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'That file is not a valid image.' });
            }

            // Rename to the extension implied by the real signature
            const finalName = `${req.file.filename}.${detected.ext}`;
            const finalPath = path.join(UPLOAD_DIR, finalName);
            fs.renameSync(req.file.path, finalPath);

            res.status(201).json({
                url: `/uploads/${finalName}`,
                filename: finalName,
                size: buffer.length,
                mime: detected.mime
            });
        } catch (error) {
            console.error('Upload error:', error);
            try { fs.unlinkSync(req.file.path); } catch (cleanup) { /* ignore */ }
            res.status(500).json({ error: 'Upload failed.' });
        }
    });
});

// Multer errors must not crash the request
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Image is too large (8 MB maximum).'
            : 'Upload failed.';
        return res.status(400).json({ error: message });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    next();
});

module.exports = router;
