const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'db.json');

function readDb() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
    } catch (error) {
        console.error('Error reading database:', error);
    }
    return null;
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing database:', error);
    }
}

// Route params arrive as strings; stored ids are numbers. Coerce so `===` works.
function num(value) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
}

// Write atomically: a partial or clobbered db.json must never be left behind.
// Node writes are synchronous within a process, so a temp-file + rename is
// enough to keep db.json valid even if the process dies mid-write.
function writeDb(data) {
    const tmp = `${DB_PATH}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, DB_PATH);
    } catch (error) {
        console.error('Error writing database:', error);
        try { fs.unlinkSync(tmp); } catch (cleanup) { /* ignore */ }
    }
}

function initDb() {
    const db = readDb();
    if (db) return db;

    const newDb = {
        users: [],
        categories: [],
        articles: [],
        comments: [],
        ad_slots: [],
        site_settings: []
    };

    // Seed initial data
    const hashedPassword = bcrypt.hashSync('admin123', 10);

    newDb.users = [
        { id: 1, email: 'super@redhan.mv', password: hashedPassword, name: 'Super Admin', role: 'superadmin', bio: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 2, email: 'admin@redhan.mv', password: hashedPassword, name: 'Admin User', role: 'admin', bio: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 3, email: 'writer@redhan.mv', password: hashedPassword, name: 'Writer One', role: 'writer', bio: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    ];

    newDb.categories = [
        { id: 1, name: 'Politics', slug: 'politics', description: 'Political news and analysis', created_at: new Date().toISOString() },
        { id: 2, name: 'Business', slug: 'business', description: 'Business and economy', created_at: new Date().toISOString() },
        { id: 3, name: 'Climate', slug: 'climate', description: 'Climate change and environment', created_at: new Date().toISOString() },
        { id: 4, name: 'Culture', slug: 'culture', description: 'Arts, culture, and lifestyle', created_at: new Date().toISOString() },
        { id: 5, name: 'Development', slug: 'development', description: 'Infrastructure and development', created_at: new Date().toISOString() }
    ];

    newDb.articles = [
        {
            id: 1,
            title: 'Government Announces Major Economic Reform Package',
            slug: 'government-announces-economic-reform',
            excerpt: 'The Maldives government has unveiled a comprehensive economic reform package aimed at boosting tourism and diversifying the economy.',
            content: '<p>The Maldives government has unveiled a comprehensive economic reform package aimed at boosting tourism and diversifying the economy. Key measures include tax incentives for foreign investors and infrastructure investments in coastal regions.</p><p>This landmark announcement comes after months of careful planning and consultation with international financial institutions. The reforms are expected to create thousands of new jobs and stimulate economic growth across the archipelago.</p><p>Finance Minister Ahmed Saeed stated, "These reforms represent a new chapter for the Maldives. We are committed to creating a business-friendly environment that attracts investment while protecting our natural heritage."</p>',
            featured_image: 'https://images.unsplash.com/photo-1506908729590-27b4a2df2fc9?w=600&h=400&fit=crop',
            author_id: 1,
            category_id: 1,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-10-06T10:00:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 2,
            title: 'Climate Change Threatens Low-Lying Island Nations',
            slug: 'climate-change-threatens-island-nations',
            excerpt: 'Scientists warn that rising sea levels pose an existential threat to Low-Lying Island Nations like the Maldives.',
            content: '<p>Scientists warn that rising sea levels pose an existential threat to Low-Lying Island Nations. A new study highlights urgent adaptation strategies needed for island communities facing displacement risks.</p><p>The research, published in the journal Nature Climate Change, reveals that current emission trajectories could lead to significant sea-level rise by 2100, threatening the very existence of many Pacific and Indian Ocean island nations.</p><p>Environmental activist Aminath Shauna emphasized, "Climate change is not a distant threat for us. It is our present reality. We need immediate global action to reduce emissions and support vulnerable nations."</p>',
            featured_image: 'https://images.unsplash.com/photo-1472099645785-5686d5596074?w=600&h=400&fit=crop',
            author_id: 2,
            category_id: 3,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-10-05T14:30:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 3,
            title: 'Cultural Festival Celebrates Maldivian Heritage',
            slug: 'cultural-festival-maldivian-heritage',
            excerpt: 'The annual Maldivian Cultural Festival brought together artists, musicians, and dancers from across the islands.',
            content: '<p>The annual Maldivian Cultural Festival brought together artists, musicians, and dancers from across the islands, showcasing the rich traditions of the nation and fostering community pride.</p><p>Held over three days in Malé, the festival featured traditional Bodu Beru drumming, dance performances, craft exhibitions, and culinary showcases from all 20 atolls.</p><p>Festival director Ahmed Niyaz expressed his satisfaction: "This year\'s festival has been our most successful yet. We saw record attendance and incredible participation from communities across the Maldives."</p>',
            featured_image: 'https://images.unsplash.com/photo-1529151370375-00cf4d131ab3?w=600&h=400&fit=crop',
            author_id: 3,
            category_id: 4,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-10-04T09:15:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 4,
            title: 'New Coastal Development Projects in Malé',
            slug: 'coastal-development-projects-male',
            excerpt: 'Urban planners unveil plans for sustainable coastal expansion, focusing on eco-friendly designs.',
            content: '<p>Urban planners unveil plans for sustainable coastal expansion, focusing on eco-friendly designs and improved public spaces along the capital city\'s shoreline. The initiative aims to balance growth with environmental preservation.</p><p>The ambitious project includes the construction of new sea walls, mangrove restoration areas, and pedestrian-friendly promenades. Environmental impact assessments have been completed and the project is awaiting final government approval.</p>',
            featured_image: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&h=400&fit=crop',
            author_id: 2,
            category_id: 5,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-10-03T16:45:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 5,
            title: 'Tech Startups Boost Digital Economy',
            slug: 'tech-startups-boost-digital-economy',
            excerpt: 'The rise of digital entrepreneurship has transformed Maldivian startups, attracting investment.',
            content: '<p>The rise of digital entrepreneurship has transformed Maldivian startups, attracting investment and creating jobs across the archipelago. Innovation hubs are emerging in Malé and Haafu.</p><p>According to the Maldives Business Registry, the number of registered tech companies has increased by 40% over the past two years. Government incentives and improved internet infrastructure have been key drivers of this growth.</p>',
            featured_image: 'https://images.unsplash.com/photo-1499750314580-4679797f1d2c?w=600&h=400&fit=crop',
            author_id: 3,
            category_id: 2,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-10-02T11:20:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 6,
            title: 'Ocean Conservation Initiatives Launched',
            slug: 'ocean-conservation-initiatives-launched',
            excerpt: 'New conservation programs aim to protect marine biodiversity in the Maldives.',
            content: '<p>New conservation programs aim to protect marine biodiversity in the Maldives. Community-led efforts are gaining momentum as the country strengthens its environmental protections.</p><p>The initiatives include coral reef restoration projects, sustainable fishing practices, and the establishment of marine protected areas covering over 30% of Maldivian waters.</p>',
            featured_image: 'https://images.unsplash.com/photo-1441974231531-272f92b0e56f?w=600&h=400&fit=crop',
            author_id: 1,
            category_id: 3,
            status: 'published',
            views: 0,
            tags: '',
            published_at: '2026-09-30T08:00:00Z',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }
    ];

    // Advertising is a fixed set of placements that exist everywhere on the
    // site. Each one only carries an uploaded image + a destination link.
    newDb.ad_slots = [
        { id: 1, name: 'Header banner', position: 'header', label: 'Wide banner below the navigation', image_url: null, link_url: null, is_active: false, created_at: new Date().toISOString() },
        { id: 2, name: 'Reading rail', position: 'rail', label: 'Sidebar slot on the home page and articles', image_url: null, link_url: null, is_active: false, created_at: new Date().toISOString() },
        { id: 3, name: 'In-feed', position: 'inline', label: 'Between the story grid on the home page', image_url: null, link_url: null, is_active: false, created_at: new Date().toISOString() },
        { id: 4, name: 'In article', position: 'article', label: 'Inside every story, below the body', image_url: null, link_url: null, is_active: false, created_at: new Date().toISOString() },
        { id: 5, name: 'Footer banner', position: 'footer', label: 'Wide banner above the footer, site-wide', image_url: null, link_url: null, is_active: false, created_at: new Date().toISOString() }
    ];

    newDb.stats = {};
    newDb.comments = [];
    newDb.site_settings = [];

    writeDb(newDb);
    return newDb;
}

// Database operations
const db = {
    // Users
    getUser: (email) => {
        const data = readDb();
        return data.users.find(u => u.email === email);
    },
    getUserById: (id) => {
        const data = readDb();
        return data.users.find(u => u.id === num(id));
    },
    createUser: (user) => {
        const data = readDb();
        user.id = data.users.length > 0 ? Math.max(...data.users.map(u => u.id)) + 1 : 1;
        user.created_at = new Date().toISOString();
        user.updated_at = new Date().toISOString();
        data.users.push(user);
        writeDb(data);
        return user;
    },
    updateUser: (id, updates) => {
        const data = readDb();
        const index = data.users.findIndex(u => u.id === num(id));
        if (index === -1) return null;
        data.users[index] = { ...data.users[index], ...updates, updated_at: new Date().toISOString() };
        writeDb(data);
        return data.users[index];
    },
    deleteUser: (id) => {
        const data = readDb();
        data.users = data.users.filter(u => u.id !== num(id));
        writeDb(data);
    },
    getAllUsers: () => readDb().users,

    // Articles
    getArticle: (id) => {
        const data = readDb();
        return data.articles.find(a => a.id === num(id));
    },
    getArticleBySlug: (slug) => {
        const data = readDb();
        return data.articles.find(a => a.slug === slug);
    },
    getArticles: (filters = {}) => {
        let data = readDb().articles;
        if (filters.status) data = data.filter(a => a.status === filters.status);
        if (filters.category_id) data = data.filter(a => a.category_id === num(filters.category_id));
        if (filters.author_id) data = data.filter(a => a.author_id === num(filters.author_id));
        if (filters.search) {
            const search = filters.search.toLowerCase();
            data = data.filter(a => a.title.toLowerCase().includes(search) || a.excerpt.toLowerCase().includes(search));
        }
        data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return data;
    },
    createArticle: (article) => {
        const data = readDb();
        article.id = data.articles.length > 0 ? Math.max(...data.articles.map(a => a.id)) + 1 : 1;
        article.created_at = new Date().toISOString();
        article.updated_at = new Date().toISOString();
        data.articles.push(article);
        writeDb(data);
        return article;
    },
    updateArticle: (id, updates) => {
        const data = readDb();
        const index = data.articles.findIndex(a => a.id === num(id));
        if (index === -1) return null;
        data.articles[index] = { ...data.articles[index], ...updates, updated_at: new Date().toISOString() };
        writeDb(data);
        return data.articles[index];
    },
    deleteArticle: (id) => {
        const data = readDb();
        const articleId = num(id);
        data.articles = data.articles.filter(a => a.id !== articleId);
        // Cascade: remove comments belonging to the deleted article
        data.comments = data.comments.filter(c => c.article_id !== articleId);
        writeDb(data);
    },

    // Categories
    getCategory: (id) => {
        const data = readDb();
        return data.categories.find(c => c.id === num(id));
    },
    getCategoryBySlug: (slug) => {
        const data = readDb();
        return data.categories.find(c => c.slug === slug);
    },
    getCategories: () => readDb().categories,
    createCategory: (category) => {
        const data = readDb();
        category.id = data.categories.length > 0 ? Math.max(...data.categories.map(c => c.id)) + 1 : 1;
        category.created_at = new Date().toISOString();
        data.categories.push(category);
        writeDb(data);
        return category;
    },
    updateCategory: (id, updates) => {
        const data = readDb();
        const index = data.categories.findIndex(c => c.id === num(id));
        if (index === -1) return null;
        data.categories[index] = { ...data.categories[index], ...updates };
        writeDb(data);
        return data.categories[index];
    },
    deleteCategory: (id) => {
        const data = readDb();
        data.categories = data.categories.filter(c => c.id !== num(id));
        writeDb(data);
    },

    // Comments
    getComment: (id) => {
        const data = readDb();
        return data.comments.find(c => c.id === num(id));
    },
    getCommentsByArticle: (articleId) => {
        return readDb().comments.filter(c => c.article_id === num(articleId));
    },
    createComment: (comment) => {
        const data = readDb();
        comment.id = data.comments.length > 0 ? Math.max(...data.comments.map(c => c.id)) + 1 : 1;
        comment.created_at = new Date().toISOString();
        data.comments.push(comment);
        writeDb(data);
        return comment;
    },
    updateComment: (id, updates) => {
        const data = readDb();
        const index = data.comments.findIndex(c => c.id === num(id));
        if (index === -1) return null;
        data.comments[index] = { ...data.comments[index], ...updates };
        writeDb(data);
        return data.comments[index];
    },
    deleteComment: (id) => {
        const data = readDb();
        data.comments = data.comments.filter(c => c.id !== num(id));
        writeDb(data);
    },

    // Ads
    getAds: () => readDb().ad_slots,
    getAd: (id) => {
        const data = readDb();
        return data.ad_slots.find(a => a.id === num(id));
    },




    // Settings
    getSettings: () => {
        const data = readDb();
        const settings = {};
        data.site_settings.forEach(s => settings[s.key] = s.value);
        return settings;
    },
    updateSetting: (key, value) => {
        const data = readDb();
        const index = data.site_settings.findIndex(s => s.key === key);
        if (index === -1) {
            data.site_settings.push({ key, value, updated_at: new Date().toISOString() });
        } else {
            data.site_settings[index] = { ...data.site_settings[index], value, updated_at: new Date().toISOString() };
        }
        writeDb(data);
    },

    // Ads — fixed placements, keyed by position
    getAds: () => readDb().ad_slots,

    getAd: (id) => {
        const data = readDb();
        return data.ad_slots.find(a => a.id === num(id));
    },

    getAdByPosition: (position) => {
        const data = readDb();
        return data.ad_slots.find(a => a.position === position) || null;
    },

    // Placements are created by the seed/migration, so this is an upsert
    upsertAd: (position, updates) => {
        const data = readDb();
        const index = data.ad_slots.findIndex(a => a.position === position);
        if (index === -1) return null;
        data.ad_slots[index] = { ...data.ad_slots[index], ...updates };
        writeDb(data);
        return data.ad_slots[index];
    },

    /* ---------------- Event tracking ----------------
       One store for everything we measure, keyed by subject:
         ad:<position>   advert impressions / clicks
         article:<id>    feed impressions / teaser clicks
         page:<path>     page views
       Shape: { [key]: { 'YYYY-MM-DD': { impressions, clicks } } }
       'views' reuses the impressions bucket for page paths.          */
    recordEvent: (key, type) => {
        const data = readDb();
        if (!data.stats) data.stats = {};

        const day = new Date().toISOString().slice(0, 10);
        if (!data.stats[key]) data.stats[key] = {};

        let bucket = data.stats[key][day];
        if (!bucket) {
            bucket = { impressions: 0, clicks: 0 };
            data.stats[key][day] = bucket;
        }

        if (type === 'click') bucket.clicks += 1;
        else bucket.impressions += 1;

        // Keep 90 days per key
        const dates = Object.keys(data.stats[key]).sort();
        if (dates.length > 90) {
            dates.slice(0, dates.length - 90).forEach(d => {
                delete data.stats[key][d];
            });
        }

        writeDb(data);
        return bucket;
    },

    // Raw daily totals for one key over the last `days` days
    getEventSeries: (key, days = 14) => {
        const data = readDb();
        const perDay = (data.stats || {})[key] || {};

        const series = [];
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const date = d.toISOString().slice(0, 10);
            const b = perDay[date] || { impressions: 0, clicks: 0 };
            series.push({
                date,
                impressions: b.impressions,
                clicks: b.clicks
            });
        }
        return series;
    },

    // Totals for a set of matching keys (e.g. every 'article:' key)
    getEventTotals: (prefix, days = 14) => {
        const data = readDb();
        const stats = data.stats || {};

        const cutoff = (() => {
            const d = new Date();
            d.setDate(d.getDate() - (days - 1));
            return d.toISOString().slice(0, 10);
        })();

        let impressions = 0;
        let clicks = 0;

        Object.keys(stats).forEach(key => {
            if (!key.startsWith(prefix)) return;
            Object.keys(stats[key]).forEach(date => {
                if (date < cutoff) return;
                impressions += stats[key][date].impressions || 0;
                clicks += stats[key][date].clicks || 0;
            });
        });

        return { impressions, clicks };
    },

    // Everything the site-wide analytics panel needs
    getSiteStats: (days = 14) => {
        const data = readDb();
        const stats = data.stats || {};

        // --- page views ---
        const pageKeys = Object.keys(stats).filter(k => k.startsWith('page:'));
        let pageImpressions = 0;
        let pageClicks = 0;
        const topPages = [];

        pageKeys.forEach(key => {
            let imp = 0;
            let clk = 0;
            Object.keys(stats[key]).forEach(date => {
                imp += stats[key][date].impressions || 0;
                clk += stats[key][date].clicks || 0;
            });
            pageImpressions += imp;
            pageClicks += clk;
            topPages.push({ path: key.slice(5), views: imp });
        });
        topPages.sort((a, b) => b.views - a.views);

        // Combined daily page-view series
        const pageSeries = [];
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            pageSeries.push({ date: d.toISOString().slice(0, 10), views: 0, clicks: 0 });
        }
        pageKeys.forEach(key => {
            Object.keys(stats[key]).forEach(date => {
                const row = pageSeries.find(r => r.date === date);
                if (row) {
                    row.views += stats[key][date].impressions || 0;
                    row.clicks += stats[key][date].clicks || 0;
                }
            });
        });

        // --- articles ---
        const articles = data.articles.map(a => {
            const s = stats['article:' + a.id] || {};
            let impressions = 0;
            let clicks = 0;
            Object.keys(s).forEach(date => {
                impressions += s[date].impressions || 0;
                clicks += s[date].clicks || 0;
            });
            return {
                id: a.id,
                title: a.title,
                slug: a.slug,
                status: a.status,
                reads: a.views || 0,
                impressions,
                clicks,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0
            };
        });
        articles.sort((x, y) => (y.impressions - x.impressions) || (y.reads - x.reads));

        return {
            pages: {
                views: pageImpressions,
                clicks: pageClicks,
                series: pageSeries,
                top: topPages.slice(0, 8)
            },
            articles
        };
    },

    // Stats    // Stats
    getStats: () => {
        const data = readDb();
        return {
            totalArticles: data.articles.length,
            publishedArticles: data.articles.filter(a => a.status === 'published').length,
            draftArticles: data.articles.filter(a => a.status === 'draft').length,
            totalUsers: data.users.length,
            totalComments: data.comments.length
        };
    }
};

// Initialize database
initDb();

/* Bring pre-existing ad_stats into the unified event store. */
(function migrateAdStats() {
    const data = readDb();
    if (!data.ad_stats || typeof data.ad_stats !== 'object') return;
    if (!data.stats) data.stats = {};
    Object.keys(data.ad_stats).forEach(position => {
        const key = 'ad:' + position;
        if (!data.stats[key]) data.stats[key] = {};
        Object.keys(data.ad_stats[position]).forEach(date => {
            const src = data.ad_stats[position][date];
            const dst = data.stats[key][date] || { impressions: 0, clicks: 0 };
            dst.impressions += src.impressions || 0;
            dst.clicks += src.clicks || 0;
            data.stats[key][date] = dst;
        });
    });
    delete data.ad_stats;
    writeDb(data);
})();

// Bring an older database up to the fixed-placement model: the canonical
// slots must exist, and any legacy slot that is not canonical is retired.
(function migrateAdSlots() {
    const data = readDb();
    if (!data || !Array.isArray(data.ad_slots)) return;

    const CANONICAL = ['header', 'rail', 'inline', 'article', 'footer'];
    const LABELS = {
        header: 'Wide banner below the navigation',
        rail: 'Sidebar slot on the home page and articles',
        inline: 'Between the story grid on the home page',
        article: 'Inside every story, below the body',
        footer: 'Wide banner above the footer, site-wide'
    };
    const NAMES = {
        header: 'Header banner', rail: 'Reading rail', inline: 'In-feed',
        article: 'In article', footer: 'Footer banner'
    };

    let changed = false;

    CANONICAL.forEach((position, i) => {
        if (!data.ad_slots.some(a => a.position === position)) {
            data.ad_slots.push({
                id: Date.now() + i,
                name: NAMES[position],
                position,
                label: LABELS[position],
                image_url: null,
                link_url: null,
                is_active: false,
                created_at: new Date().toISOString()
            });
            changed = true;
        }
    });

    // Retire anything outside the canonical set (e.g. the old 'sidebar' slot)
    const before = data.ad_slots.length;
    data.ad_slots = data.ad_slots.filter(a => CANONICAL.includes(a.position));
    if (data.ad_slots.length !== before) changed = true;

    // Normalise legacy records: canonical names, no leftover 'content' field
    const LEGACY_NAMES = {
        'Header Banner': 'Header banner',
        'Sidebar Ad': 'Reading rail',
        'Footer Ad': 'Footer banner'
    };
    data.ad_slots.forEach(a => {
        if (LEGACY_NAMES[a.name]) {
            a.name = LEGACY_NAMES[a.name];
            changed = true;
        }
        if ('content' in a) {
            delete a.content;
            changed = true;
        }
        if (!a.label) {
            a.label = LABELS[a.position] || '';
            changed = true;
        }
    });

    if (changed) writeDb(data);
})();

module.exports = db;
