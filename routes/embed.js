const express = require('express');
const router = express.Router();
const security = require('../config/security');

/* ============================================================
   oEmbed RESOLVER
   Turns a pasted URL into something we can render ourselves:
   no third-party scripts are needed on the page, so the CSP
   stays tight and nothing tracks our readers.
   ============================================================ */

const PROVIDERS = [
    {
        name: 'twitter',
        label: 'X / Twitter',
        match: (u) => /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(u),
        endpoint: (u) => `https://publish.twitter.com/oembed?url=${encodeURIComponent(u)}&omit_script=true&dnt=true`
    },
    {
        name: 'facebook',
        label: 'Facebook',
        match: (u) => /^https?:\/\/(www\.|m\.|business\.)?facebook\.com\/.+/i.test(u),
        endpoint: (u) => `https://www.facebook.com/plugins/post/oembed.json/?href=${encodeURIComponent(u)}&omitscript=true`
    },
    {
        name: 'instagram',
        label: 'Instagram',
        match: (u) => /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[^/]+/i.test(u),
        endpoint: (u) => `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(u)}&omitscript=true`
    },
    {
        name: 'youtube',
        label: 'YouTube',
        match: (u) => /^https?:\/\/(www\.|m\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/i.test(u),
        endpoint: null     // handled locally with an iframe
    },
    {
        name: 'vimeo',
        label: 'Vimeo',
        match: (u) => /^https?:\/\/(www\.)?vimeo\.com\/\d+/i.test(u),
        endpoint: null     // player URL is deterministic
    },
    {
        name: 'tiktok',
        label: 'TikTok',
        match: (u) => /^https?:\/\/(www\.|vm\.)?tiktok\.com\/.+/i.test(u),
        endpoint: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`
    }
];

/* YouTube / Vimeo: build the player ourselves, no network call needed */
function localPlayer(url) {
    let m = /^https?:\/\/(www\.|m\.)?youtube\.com\/watch\?.*?v=([\w-]+)/i.exec(url);
    if (m) {
        return {
            provider: 'youtube',
            html: `<iframe src="https://www.youtube-nocookie.com/embed/${m[2]}" title="YouTube video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`,
            aspect: '16 / 9'
        };
    }

    m = /^https?:\/\/youtu\.be\/([\w-]+)/i.exec(url);
    if (m) {
        return {
            provider: 'youtube',
            html: `<iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="YouTube video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`,
            aspect: '16 / 9'
        };
    }

    m = /^https?:\/\/(www\.)?vimeo\.com\/(\d+)/i.exec(url);
    if (m) {
        return {
            provider: 'vimeo',
            html: `<iframe src="https://player.vimeo.com/video/${m[2]}" title="Vimeo video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`,
            aspect: '16 / 9'
        };
    }

    return null;
}

/* Any embeddable URL that is not http(s) is rejected outright */
function safeUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.href;
    } catch (err) {
        return null;
    }
}

const TIMEOUT_MS = 6000;

function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    return fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RedhanNews/1.0 (+https://redhan.mv)' }
    })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .finally(() => clearTimeout(timer));
}

// @route   GET /api/embed/resolve?url=...
// @desc    Resolve a pasted URL into renderable embed data.
//          Returns provider metadata plus sanitised HTML. If the provider
//          cannot be reached we fall back to a plain link card, so an embed
//          never breaks an article.
router.get('/resolve', async (req, res) => {
    const url = safeUrl(String(req.query.url || ''));
    if (!url) {
        return res.status(400).json({ error: 'That is not a valid http(s) URL.' });
    }

    const provider = PROVIDERS.find(p => p.match(url));
    if (!provider) {
        return res.status(422).json({
            error: 'That URL cannot be embedded. Supported: X/Twitter, Facebook, Instagram, YouTube, Vimeo and TikTok.'
        });
    }

    // Video players need no network call
    if (!provider.endpoint) {
        const local = localPlayer(url);
        if (!local) {
            return res.status(422).json({ error: 'Could not build a player for that URL.' });
        }
        return res.json({
            provider: local.provider,
            label: provider.label,
            url,
            html: local.html,
            aspect: local.aspect
        });
    }

    fetchJson(provider.endpoint(url)).then((data) => {
        if (!data) {
            // Provider unreachable or blocked: a link card still reads well
            return res.json({
                provider: provider.name,
                label: provider.label,
                url,
                html: '',
                aspect: null
            });
        }

        res.json({
            provider: provider.name,
            label: provider.label,
            url,
            // Strip scripts the providers inject; we render our own markup
            html: security.sanitizeHtml(data.html || ''),
            aspect: null,
            author: security.sanitizeHtml(data.author_name || data.author || ''),
            authorUrl: safeUrl(data.author_url || '') || null,
            title: security.sanitizeHtml(data.title || ''),
            thumbnail: safeUrl(data.thumbnail_url || '') || null
        });
    });
});

module.exports = router;
