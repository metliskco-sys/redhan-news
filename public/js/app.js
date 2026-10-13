// ============================================
// MAIN APPLICATION
// ============================================
// NOTE: must be `var`, not `let` — a top-level `let` creates a global lexical
// binding that shadows `window.app`, so inline onclick="app.foo()" handlers
// would resolve to `null` and throw.
var app = null;

class RedhanApp {
    constructor() {
        this.currentUser = null;
        this.articles = [];
        this.categories = [];
        this.ads = [];
        this.currentCategory = 'all';
        this.initialized = false;
        this.init();
    }

    async init() {
        try {
            this.initChrome();
            this.bindEvents();
            this.bindCoverUploader();
            this.initScrollProgress();
            this.parseUrlParams();
            this.initReveal();
            await this.loadInitialData();
            this.initHeadlineReveal();
            this.checkAuth();
            this.initScrollEffects();
            this.initReveal();
            this.initialized = true;

            // Staff desk: /desk opens the panel for editorial roles, else login
            if (window.location.pathname === '/desk') {
                if (['admin', 'superadmin'].includes(this.currentUser?.role)) {
                    await this.openAdminPanel();
                } else {
                    window.location.replace('/login');
                }
                return;
            }

            // Login page redirects admins here with ?desk=1
            const params = new URLSearchParams(window.location.search);
            if (params.get('desk') === '1') {
                params.delete('desk');
                const clean = params.toString();
                window.history.replaceState(null, '', clean ? `/?${clean}` : '/');
                if (['admin', 'superadmin'].includes(this.currentUser?.role)) {
                    await this.openAdminPanel();
                }
            }
        } catch (error) {
            console.error('App initialization failed:', error);
            this.showToast('App failed to initialize. Please refresh.', 'error');
        }
    }

    /* Scroll-reveal for anything marked .reveal / .stagger */
    initReveal() {
        const targets = document.querySelectorAll('.reveal, .stagger');
        if (!('IntersectionObserver' in window)) {
            targets.forEach(t => t.classList.add('is-in'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
        targets.forEach(t => io.observe(t));
    }

    /* Animated number */
    countUp(el, target, duration = 900) {
        if (!el) return;
        const t0 = performance.now();
        const step = (now) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(target * eased));
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    /* 7-day publishing activity chart (CSS bars) */
    renderActivityChart() {
        const wrap = document.getElementById('activityChart');
        const note = document.getElementById('activityNote');
        if (!wrap) return;

        const pool = this.adminArticles || this.articles;
        const days = [];
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            days.push(d);
        }

        const counts = days.map(d => pool.filter(a => {
            const raw = a.published_at || a.created_at;
            const ad = new Date(raw);
            if (isNaN(ad.getTime())) return false;
            ad.setHours(0, 0, 0, 0);
            return ad.getTime() === d.getTime();
        }).length);

        const total = counts.reduce((s, n) => s + n, 0);
        if (note) note.style.display = total === 0 ? 'block' : 'none';

        const max = Math.max(...counts, 1);
        const labels = days.map(d => d.toLocaleDateString('en-GB', { weekday: 'short' }));

        wrap.innerHTML = counts.map((n, i) => `
            <div class="chart__col" title="${labels[i]}: ${n} published">
                <div class="chart__bar" data-h="${Math.round((n / max) * 100)}">
                    <span>${n}</span>
                </div>
                <div class="chart__label">${labels[i].slice(0, 2)}</div>
            </div>`).join('');

        // Animate bars in
        requestAnimationFrame(() => {
            wrap.querySelectorAll('.chart__bar').forEach(bar => {
                bar.style.height = Math.max(3, parseInt(bar.dataset.h, 10)) + '%';
            });
        });
    }

    /* Activity feed assembled from real records */
    renderActivityFeed(stats, recentArticles, recentUsers) {
        const feed = document.getElementById('activityFeed');
        if (!feed) return;

        const items = [];

        (recentArticles || []).slice(0, 4).forEach(a => {
            const when = a.updated_at || a.created_at;
            items.push({
                tone: a.status === 'published' ? 'ok' : 'iris',
                html: `<b>${this.esc(a.title)}</b> ${a.status === 'published' ? 'published' : 'saved as draft'} by ${this.esc(a.author_name || 'staff')}`,
                when
            });
        });

        (recentUsers || []).slice(0, 3).forEach(u => {
            items.push({
                tone: '',
                html: `<b>${this.esc(u.name)}</b> joined as ${this.esc(u.role)}`,
                when: u.created_at
            });
        });

        if (stats && stats.totalComments > 0) {
            items.push({
                tone: 'warn',
                html: `<b>${stats.totalComments}</b> comment${stats.totalComments === 1 ? '' : 's'} awaiting moderation`,
                when: null
            });
        }

        items.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

        feed.innerHTML = items.length === 0
            ? '<div class="feed__item"><div class="feed__dot"></div><div><div class="feed__text">No activity yet.</div></div></div>'
            : items.slice(0, 6).map(i => `
                <div class="feed__item">
                    <div class="feed__dot ${i.tone ? 'feed__dot--' + i.tone : ''}"></div>
                    <div>
                        <div class="feed__text">${i.html}</div>
                        ${i.when ? `<div class="feed__time">${this.formatDate(i.when)}</div>` : ''}
                    </div>
                </div>`).join('');
    }
    initChrome() {
        try {
            const now = new Date();
            const dateEl = document.getElementById('todayDate');
            if (dateEl) {
                dateEl.textContent = now.toLocaleDateString('en-GB', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                });
            }
            const yearEl = document.getElementById('year');
            if (yearEl) yearEl.textContent = String(now.getFullYear());
        } catch (error) {
            console.error('Chrome init failed:', error);
        }

        const newsletterBtn = document.getElementById('newsletterBtn');
        const newsletterEmail = document.getElementById('newsletterEmail');
        if (newsletterBtn && newsletterEmail) {
            newsletterBtn.addEventListener('click', () => {
                const email = newsletterEmail.value.trim();
                if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
                    this.showToast('Enter a valid email address.', 'error');
                    return;
                }
                this.showToast('Thanks — you are on the list.', 'success');
                newsletterEmail.value = '';
            });
        }
    }

    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const category = params.get('category');
        const known = ['all', 'politics', 'business', 'climate', 'culture', 'development'];
        if (category && known.includes(category)) {
            this.setCategory(category, { push: false });
        }
    }

    // Single source of truth for category state: updates filter, chips, nav and URL.
    setCategory(category, { push = true } = {}) {
        this.currentCategory = category;

        // Sync filter chips
        document.querySelectorAll('#categoryFilter .chip').forEach(b => {
            b.classList.toggle('is-active', b.dataset.category === category);
        });

        // Sync top nav links
        const navByCategory = { politics: 'news', business: 'business', climate: 'climate', culture: 'lifestyle' };
        document.querySelectorAll('.nav-link').forEach(l => {
            const section = l.dataset.section;
            const isActive = category === 'all'
                ? section === 'home'
                : navByCategory[category] === section;
            l.classList.toggle('is-active', isActive);
        });

        if (push && window.history && window.history.pushState) {
            const url = category === 'all' ? '/' : `/?category=${category}`;
            window.history.pushState({ category }, '', url);
        }

        this.renderArticles();
    }

    // ============================================
    // EVENT BINDING
    // ============================================
    bindEvents() {
        // Mobile navigation toggle
        const mobileNavToggle = document.getElementById('mobileNavToggle');
        const mainNav = document.getElementById('mainNav');
        if (mobileNavToggle && mainNav) {
            mobileNavToggle.addEventListener('click', () => {
                const isOpen = mainNav.classList.toggle('is-open');
                mobileNavToggle.setAttribute('aria-expanded', String(isOpen));
            });
        }

        // Search toggle
        const searchToggle = document.getElementById('searchToggle');
        const searchBar = document.getElementById('searchBar');
        const searchInput = document.getElementById('searchInput');
        if (searchToggle && searchBar && searchInput) {
            searchToggle.addEventListener('click', () => {
                const isOpen = searchBar.classList.toggle('is-open');
                if (isOpen) searchInput.focus();
            });
        }

        // Search functionality
        const searchSubmit = document.getElementById('searchSubmit');
        if (searchSubmit) {
            searchSubmit.addEventListener('click', () => this.performSearch());
        }
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }

        // Category filter
        document.querySelectorAll('#categoryFilter .chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setCategory(btn.dataset.category);
            });
        });

        // Top navigation links: map to category filters with real URL updates
        const navCategory = {
            home: 'all', news: 'politics', business: 'business',
            climate: 'climate', lifestyle: 'culture', gallery: null
        };
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                if (!section) return;

                if (section === 'search') {
                    searchBar?.classList.add('is-open');
                    searchInput?.focus();
                    return;
                }

                const category = navCategory[section];
                if (category === null) {
                    this.showToast('Gallery is coming soon.', 'info');
                    return;
                }

                this.setCategory(category);
                document.getElementById('articleGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        // Browser back/forward should restore the category view
        window.addEventListener('popstate', (e) => {
            const category = e.state && e.state.category ? e.state.category : 'all';
            this.setCategory(category, { push: false });
        });

        // Login/Register modals
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.addEventListener('click', (e) => {
                if (e.target.id === 'loginModal' || e.target.id === 'loginModalOverlay') {
                    this.closeModal('loginModal');
                }
            });
        }

        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        // Login <-> Register switch inside the modal
        const swapAuth = (showRegister) => {
            const loginFormEl = document.getElementById('loginForm');
            const registerFormEl = document.getElementById('registerForm');
            const switchWrap = document.getElementById('switchWrap');
            const switchBack = document.getElementById('switchBack');
            const title = document.getElementById('loginModalTitle');
            if (loginFormEl && registerFormEl) {
                loginFormEl.style.display = showRegister ? 'none' : 'flex';
                registerFormEl.style.display = showRegister ? 'flex' : 'none';
            }
            if (switchWrap && switchBack) {
                switchWrap.style.display = showRegister ? 'none' : 'block';
                switchBack.style.display = showRegister ? 'block' : 'none';
            }
            if (title) title.textContent = showRegister ? 'Join the desk' : 'Staff access';
        };

        const switchToRegister = document.getElementById('switchToRegister');
        if (switchToRegister) {
            switchToRegister.addEventListener('click', (e) => { e.preventDefault(); swapAuth(true); });
        }

        const switchToLogin = document.getElementById('switchToLogin');
        if (switchToLogin) {
            switchToLogin.addEventListener('click', (e) => { e.preventDefault(); swapAuth(false); });
        }

        const loginModalClose = document.getElementById('loginModalClose');
        if (loginModalClose) {
            loginModalClose.addEventListener('click', () => this.closeModal('loginModal'));
        }

        // Admin panel
        const adminPanelClose = document.getElementById('adminPanelClose');
        if (adminPanelClose) {
            adminPanelClose.addEventListener('click', () => this.closeAdminPanel());
        }

        const adminLogout = document.getElementById('adminLogout');
        if (adminLogout) {
            adminLogout.addEventListener('click', () => this.handleLogout());
        }

        // Admin navigation
        document.querySelectorAll('.admin__nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.admin__nav-link').forEach(l => l.classList.remove('is-active'));
                link.classList.add('is-active');
                this.showAdminSection(link.dataset.adminSection);
                document.getElementById('adminSidebar')?.classList.remove('is-open');
            });
        });

        // Article modal
        const articleModalClose = document.getElementById('articleModalClose');
        if (articleModalClose) {
            articleModalClose.addEventListener('click', () => this.closeModal('articleModal'));
        }

        const articleCancelBtn = document.getElementById('articleCancelBtn');
        if (articleCancelBtn) {
            articleCancelBtn.addEventListener('click', () => this.closeModal('articleModal'));
        }

        const articleModalOverlay = document.getElementById('articleModalOverlay');
        if (articleModalOverlay) {
            articleModalOverlay.addEventListener('click', () => this.closeModal('articleModal'));
        }

        const articleForm = document.getElementById('articleForm');
        if (articleForm) {
            articleForm.addEventListener('submit', (e) => this.handleArticleSave(e));
        }

        const newArticleBtn = document.getElementById('newArticleBtn');
        if (newArticleBtn) {
            newArticleBtn.addEventListener('click', () => this.openArticleModal());
        }

        // Category modal
        const newCategoryBtn = document.getElementById('newCategoryBtn');
        if (newCategoryBtn) {
            newCategoryBtn.addEventListener('click', () => this.openCategoryModal());
        }

        // Settings
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        }

        // New User button
        const newUserBtn = document.getElementById('newUserBtn');
        if (newUserBtn) {
            newUserBtn.addEventListener('click', () => this.openUserModal());
        }


        // Quick action on the dashboard
        const quickNewArticle = document.getElementById('quickNewArticle');
        if (quickNewArticle) {
            quickNewArticle.addEventListener('click', () => this.openArticleModal());
        }

        // Admin modal form submissions
        const userForm = document.getElementById('userForm');
        if (userForm) userForm.addEventListener('submit', (e) => this.handleUserSubmit(e));

        const categoryForm = document.getElementById('categoryForm');
        if (categoryForm) categoryForm.addEventListener('submit', (e) => this.handleCategorySubmit(e));

        // Embed inserter in the article editor
        const embedBtn = document.getElementById('embedInsertBtn');
        if (embedBtn) embedBtn.addEventListener('click', () => this.insertEmbed());

        const embedInput = document.getElementById('embedUrl');
        if (embedInput) {
            embedInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this.insertEmbed(); }
            });
        }


        // Any element with data-close="<modalId>" closes that modal
        document.querySelectorAll('[data-close]').forEach(el => {
            el.addEventListener('click', () => this.closeModal(el.dataset.close));
        });

        // Escape closes the top-most open overlay
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const openAdmin = document.getElementById('adminPanel');
            if (openAdmin && openAdmin.classList.contains('is-open')) {
                this.closeAdminPanel();
                return;
            }
            ['articleModal', 'userModal', 'categoryModal', 'adModal', 'loginModal'].forEach(id => {
                const m = document.getElementById(id);
                if (m && m.classList.contains('is-open')) this.closeModal(id);
            });
        });

        // Quick actions + inline navigation jumps inside the desk
        document.querySelectorAll('[data-goto]').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.goto;
                const link = document.querySelector(`.admin__nav-link[data-admin-section="${section}"]`);
                if (link) link.click();
            });
        });

        // Table filters
        const articleSearch = document.getElementById('articleSearch');
        if (articleSearch) articleSearch.addEventListener('input', () => this.applyArticleFilters());
        const articleStatusFilter = document.getElementById('articleStatusFilter');
        if (articleStatusFilter) articleStatusFilter.addEventListener('change', () => this.applyArticleFilters());
        const commentStatusFilter = document.getElementById('commentStatusFilter');
        if (commentStatusFilter) commentStatusFilter.addEventListener('change', () => this.applyCommentFilter());
        const userRoleFilter = document.getElementById('userRoleFilter');
        if (userRoleFilter) userRoleFilter.addEventListener('change', () => this.applyUserFilter());

        // Admin "view site" shortcut
        const viewSiteBtn = document.getElementById('viewSiteBtn');
        if (viewSiteBtn) {
            viewSiteBtn.addEventListener('click', () => this.closeAdminPanel());
        }
    }

    // ============================================
    // DATA LOADING
    // ============================================
    async loadInitialData() {
        const cardGrid = document.getElementById('cardGrid');
        const loadingTimeout = setTimeout(() => {
            if (this.articles.length === 0 && cardGrid) {
                cardGrid.innerHTML = `
                    <div class="state">
                        <h3>Still loading</h3>
                        <p>This is taking longer than expected.</p>
                        <button class="btn btn--sm btn--solid" onclick="location.reload()">Refresh</button>
                    </div>
                `;
            }
        }, 10000);

        try {
            // Load articles
            const articlesData = await api.getArticles({ limit: 20 });
            this.articles = articlesData.articles || [];

            // Load categories
            const categoriesData = await api.getCategories();
            this.categories = categoriesData.categories || [];

            // Load ads
            const adsData = await api.getAds();
            this.ads = adsData.ads || [];

            clearTimeout(loadingTimeout);

            // Render everything
            this.renderArticles();
            this.renderCategories();
            this.renderAds();
        } catch (error) {
            clearTimeout(loadingTimeout);
            console.error('Error loading initial data:', error);
            this.showToast('Failed to load data. Retrying...', 'error');

            // Retry once after a short delay
            setTimeout(async () => {
                try {
                    const articlesData = await api.getArticles({ limit: 20 });
                    this.articles = articlesData.articles || [];
                    const categoriesData = await api.getCategories();
                    this.categories = categoriesData.categories || [];
                    const adsData = await api.getAds();
                    this.ads = adsData.ads || [];
                    this.renderArticles();
                    this.renderCategories();
                    this.renderAds();
                    this.showToast('Data loaded successfully', 'success');
                } catch (retryError) {
                    console.error('Retry failed:', retryError);
                    if (cardGrid) {
                        cardGrid.innerHTML = `
                            <div class="state">
                                <h3>Could not load articles</h3>
                                <p>Check your connection and try again.</p>
                                <button class="btn btn--sm btn--solid" onclick="location.reload()">Refresh page</button>
                            </div>
                        `;
                    }
                }
            }, 1500);
        }
    }

    // ============================================
    // ARTICLE RENDERING
    // ============================================
    esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    formatDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return 'Undated';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    renderArticles() {
        const cardGrid = document.getElementById('cardGrid');
        const leadStory = document.getElementById('leadStory');
        const topStories = document.getElementById('topStories');
        const sectionTitle = document.getElementById('sectionTitle');
        if (!cardGrid) return;

        const inCategory = this.currentCategory !== 'all';
        const filtered = inCategory
            ? this.articles.filter(a => a.category_slug === this.currentCategory)
            : this.articles;

        window.__redhanSlugs = {};
        this.articles.forEach(a => { window.__redhanSlugs[a.slug] = a.id; });

        const activeCat = this.categories.find(c => c.slug === this.currentCategory);
        if (sectionTitle) {
            if (!inCategory) {
                sectionTitle.textContent = 'Latest';
            } else if (activeCat) {
                sectionTitle.textContent = activeCat.name;
            } else {
                // Fall back to a readable version of the slug
                sectionTitle.textContent = this.currentCategory
                    .replace(/[-_]/g, ' ')
                    .replace(/\b\w/g, m => m.toUpperCase());
            }
        }

        if (filtered.length === 0) {
            if (leadStory) leadStory.innerHTML = '';
            cardGrid.innerHTML = `
                <div class="state">
                    <h3>Nothing filed here yet</h3>
                    <p>No published stories in this section. Try another one.</p>
                    <a href="/" class="btn btn--sm">View everything</a>
                </div>`;
            if (topStories) topStories.innerHTML = '';
            return;
        }

        try {
            // Lead story (only on the unfiltered "Latest" view)
            if (leadStory) {
                const lead = inCategory ? null : filtered[0];
                leadStory.innerHTML = lead ? this.leadMarkup(lead) : '';
            }

            const list = inCategory ? filtered : filtered.slice(1);
            cardGrid.innerHTML = list.length === 0
                ? `<div class="state"><h3>Nothing filed here yet</h3><p>No other stories in this section.</p></div>`
                : list.map(a => this.cardMarkup(a)).join('');

            // Stagger + reveal the freshly rendered cards
            cardGrid.classList.add('stagger');
            this.initReveal();

            // Expose slug -> id so analytics.js can attribute clicks.
            // Analytics must never be able to break the article grid.
            try {
                window.__redhanSlugs = {};
                this.articles.forEach(a => { window.__redhanSlugs[a.slug] = a.id; });
                if (typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
                    window.dispatchEvent(new Event('redhan:rendered'));
                }
            } catch (err) {
                console.error('Analytics hook failed:', err);
            }

            // Top Stories rail — numbered, newest first, excluding the lead
            if (topStories) {
                const source = (!inCategory && filtered.length > 1) ? filtered.slice(1) : filtered;
                topStories.innerHTML = source.slice(0, 5).map((a, i) => `
                    <a class="story" href="/article?slug=${encodeURIComponent(a.slug)}">
                        <div class="story__num">${String(i + 1).padStart(2, '0')}</div>
                        <div>
                            <div class="story__title">${this.esc(a.title)}</div>
                            <div class="story__meta">${this.esc(a.category_name || 'News')} · ${this.formatDate(a.published_at)}</div>
                        </div>
                    </a>`).join('');
            }
        } catch (error) {
            console.error('Error rendering articles:', error);
            cardGrid.innerHTML = `
                <div class="state">
                    <h3>Something went wrong</h3>
                    <p>We could not render the stories. Please refresh the page.</p>
                </div>`;
        }
    }

    leadMarkup(a) {
        const href = `/article?slug=${encodeURIComponent(a.slug)}`;
        return `
            <div class="lead__kicker">
                <a href="/?category=${encodeURIComponent(a.category_slug || 'news')}" class="kicker">${this.esc(a.category_name || 'News')}</a>
            </div>
            <h1 class="lead__title"><a href="${href}">${this.esc(a.title)}</a></h1>
            <p class="lead__dek">${this.esc(a.excerpt || '')}</p>
            <a class="lead__figure" href="${href}" aria-label="${this.esc(a.title)}" data-article-id="${a.id}">
                <img src="${this.esc(a.featured_image) || 'https://via.placeholder.com/1200x675'}"
                     alt="" onerror="this.src='https://via.placeholder.com/1200x675'">
            </a>
            <div class="byline">
                <div class="avatar avatar--lg">${this.esc((a.author_name || 'A').charAt(0))}</div>
                <span class="byline__name">${this.esc(a.author_name || 'Redhan')}</span>
                <span class="byline__sep" aria-hidden="true"></span>
                <span>${this.formatDate(a.published_at)}</span>
                <span class="byline__sep" aria-hidden="true"></span>
                <a class="readmore" href="${href}">
                    Read story
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"></path></svg>
                </a>
            </div>`;
    }

    cardMarkup(a) {
        return `
            <article class="card">
                <a class="card__figure" href="/article?slug=${encodeURIComponent(a.slug)}" aria-label="${this.esc(a.title)}" data-article-id="${a.id}">
                    <img src="${this.esc(a.featured_image) || 'https://via.placeholder.com/800x450'}"
                         alt="" loading="lazy" onerror="this.src='https://via.placeholder.com/800x450'">
                    <span class="card__cat">${this.esc(a.category_name || 'News')}</span>
                </a>
                <h3 class="card__title"><a href="/article?slug=${encodeURIComponent(a.slug)}">${this.esc(a.title)}</a></h3>
                <p class="card__excerpt">${this.esc(a.excerpt || '')}</p>
                <div class="byline">
                    <div class="avatar">${this.esc((a.author_name || 'A').charAt(0))}</div>
                    <span class="byline__name">${this.esc(a.author_name || 'Redhan')}</span>
                    <span class="byline__sep" aria-hidden="true"></span>
                    <span>${this.formatDate(a.published_at)}</span>
                </div>
            </article>`;
    }

    filterArticles() {
        this.renderArticles();
    }

    // ============================================
    // CATEGORIES
    // ============================================
    renderCategories() {
        // Categories are rendered in admin panel
    }

    // ============================================
    // ADS
    // ============================================
    renderAds() {
        if (this.ads.length === 0) return;
        const randomAd = this.ads[Math.floor(Math.random() * this.ads.length)];
        const text = document.getElementById('adText');
        const link = document.getElementById('adLink');
        if (text) text.textContent = randomAd.content || '';
        if (link) link.href = randomAd.link_url || '#';
    }

    // ============================================
    // AUTHENTICATION
    // ============================================
    checkAuth() {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            this.currentUser = JSON.parse(localStorage.getItem('user'));
        } catch (error) {
            console.error('Corrupt stored user, clearing session:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            return;
        }
        if (this.currentUser && ['admin', 'superadmin'].includes(this.currentUser.role)) {
            this.markSignedIn();
        }
    }

    // No desk button in the header — staff reach the desk via /desk or the
    // footer link, which keeps the public header clean.
    markSignedIn() {
        const masthead = document.querySelector('.masthead__meta');
        if (masthead && !masthead.querySelector('.signed-in')) {
            const tag = document.createElement('a');
            tag.className = 'signed-in';
            tag.href = '/desk';
            tag.textContent = `Signed in · ${this.currentUser.name}`;
            masthead.appendChild(tag);
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const data = await api.login(email, password);
            api.setToken(data.token);
            this.currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));

            this.closeModal('loginModal');
            this.showToast('Signed in.', 'success');

            // Editorial staff go straight to the desk; readers stay put
            if (['admin', 'superadmin'].includes(data.user.role)) {
                window.location.href = '/desk';
            } else {
                this.markSignedIn();
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;

        try {
            const data = await api.signup(email, name, password);
            api.setToken(data.token);
            this.currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));

            this.closeModal('loginModal');
            this.showToast('Registration successful!', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    handleLogout() {
        api.setToken(null);
        this.currentUser = null;
        localStorage.removeItem('user');
        this.closeAdminPanel();

        document.querySelector('.masthead__meta .signed-in')?.remove();

        this.showToast('Signed out.', 'info');
    }

    // ============================================
    // ADMIN PANEL
    // ============================================
    async openAdminPanel() {
        if (!this.currentUser) {
            this.openModal('loginModal');
            return;
        }

        if (!['admin', 'superadmin'].includes(this.currentUser.role)) {
            this.showToast('Your account does not have desk access.', 'error');
            return;
        }

        const panel = document.getElementById('adminPanel');
        document.getElementById('adminRole').textContent = this.currentUser.role;
        document.getElementById('adminUserName').textContent = this.currentUser.name;
        const avatar = document.getElementById('adminUserAvatar');
        if (avatar) avatar.textContent = (this.currentUser.name || 'A').charAt(0).toUpperCase();
        if (panel) {
            panel.style.display = 'grid';
            requestAnimationFrame(() => panel.classList.add('is-open'));
            this.lockScroll(true);
        }

        // Always land on the dashboard
        this.showAdminSection('dashboard');
    }

    closeAdminPanel() {
        const panel = document.getElementById('adminPanel');
        if (panel) {
            panel.classList.remove('is-open');
            setTimeout(() => { panel.style.display = 'none'; }, 320);
            this.lockScroll(false);
        }
    }

    async showAdminSection(section) {
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('is-active'));
        document.getElementById(`admin-${section}`)?.classList.add('is-active');

        // Keep the sidebar in sync when navigated programmatically
        document.querySelectorAll('.admin__nav-link').forEach(l => {
            l.classList.toggle('is-active', l.dataset.adminSection === section);
        });

        const titles = {
            dashboard: 'Dashboard',
            articles: 'Articles',
            categories: 'Sections',
            comments: 'Comments',
            users: 'Users',
            ads: 'Ad slots',
            settings: 'Settings'
        };
        document.getElementById('adminTitle').textContent = titles[section] || 'Dashboard';

        switch (section) {
            case 'dashboard': await this.loadDashboardData(); break;
            case 'articles': await this.loadAllArticles(); break;
            case 'categories': await this.loadCategories(); break;
            case 'comments': await this.loadComments(); break;
            case 'users': await this.loadUsers(); break;
            case 'ads': await this.loadAds(); break;
        }
    }


    /* ---------------- Site-wide analytics ---------------- */
    async loadSitePerformance() {
        try {
            const data = await api.getSiteStats(14);
            this.siteStats = data;
            this.renderSitePerformance(data);
        } catch (error) {
            console.error('Error loading site performance:', error);
        }
    }

    renderSitePerformance(data) {
        const viewsEl = document.getElementById('siteViews');
        const imprEl = document.getElementById('siteArticleImpr');
        const clkEl = document.getElementById('siteArticleClicks');
        const ctrEl = document.getElementById('siteFeedCtr');
        if (!viewsEl || !data) return;

        const pages = data.pages || { views: 0, series: [], top: [] };
        const articles = data.articles || [];

        const impressions = articles.reduce((s, a) => s + a.impressions, 0);
        const clicks = articles.reduce((s, a) => s + a.clicks, 0);

        this.countUp(viewsEl, pages.views || 0);
        this.countUp(imprEl, impressions);
        this.countUp(clkEl, clicks);
        if (ctrEl) {
            ctrEl.textContent = (impressions > 0 ? (clicks / impressions) * 100 : 0).toFixed(2) + '%';
        }

        this.renderSiteChart(data);

        // Top stories: prefer ones with a measurable funnel, then by reads
        const topStories = articles.slice().sort((a, b) => {
            if (b.clicks !== a.clicks) return b.clicks - a.clicks;
            if (b.impressions !== a.impressions) return b.impressions - a.impressions;
            return b.reads - a.reads;
        }).slice(0, 6);

        const storyBody = document.getElementById('topStoriesTable');
        if (storyBody) {
            storyBody.innerHTML = topStories.length === 0
                ? '<tr><td colspan="5" class="empty-cell">No stories yet.</td></tr>'
                : topStories.map(a => `
                    <tr>
                        <td><b>${this.esc(a.title)}</b></td>
                        <td>${a.reads}</td>
                        <td>${a.impressions}</td>
                        <td>${a.clicks}</td>
                        <td class="ctr-cell">${(a.ctr || 0).toFixed(2)}%</td>
                    </tr>`).join('');
        }

        const pageBody = document.getElementById('topPagesTable');
        if (pageBody) {
            pageBody.innerHTML = (pages.top || []).length === 0
                ? '<tr><td colspan="2" class="empty-cell">No page views recorded yet.</td></tr>'
                : pages.top.map(p => `
                    <tr><td><b>${this.esc(p.path)}</b></td><td>${p.views}</td></tr>`).join('');
        }
    }

    renderSiteChart(data) {
        const chart = document.getElementById('siteChart');
        const empty = document.getElementById('siteChartEmpty');
        if (!chart) return;

        const pageSeries = (data.pages && data.pages.series) || [];
        const articles = data.articles || [];

        // Story impressions do not have a per-day series in this view, so use
        // today's snapshot as a second series anchor against page views.
        const totalImpr = articles.reduce((s, a) => s + a.impressions, 0);
        const totalViews = pageSeries.reduce((s, r) => s + (r.views || 0), 0);

        const rows = pageSeries.map(r => ({ date: r.date, views: r.views || 0 }));

        if (totalViews + totalImpr === 0 || rows.length === 0) {
            if (empty) empty.style.display = 'block';
            chart.style.display = 'none';
            chart.innerHTML = '';
            return;
        }

        if (empty) empty.style.display = 'none';
        chart.style.display = 'flex';

        const max = Math.max(...rows.map(r => r.views), 1);

        chart.innerHTML = rows.map(r => {
            const d = new Date(r.date);
            const label = isNaN(d.getTime())
                ? r.date
                : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const h = Math.max(2, (r.views / max) * 100);
            return `
                <div class="chart__col" title="${label}: ${r.views} page views">
                    <div class="chart__pair">
                        <div class="chart__bar chart__bar--imp" style="height:${h}%"><span>${r.views}</span></div>
                    </div>
                    <div class="chart__label">${label}</div>
                </div>`;
        }).join('');

        requestAnimationFrame(() => {
            chart.querySelectorAll('.chart__bar').forEach(bar => {
                const h = bar.style.height;
                bar.style.height = '2%';
                requestAnimationFrame(() => { bar.style.height = h; });
            });
        });
    }

    async loadDashboardData() {
        try {
            const [stats, recentArticles, dashData] = await Promise.all([
                api.getDashboardStats(),
                api.getRecentArticles(),
                api.getDashboardData().catch(() => null)
            ]);

            // Site-wide analytics (page views + story funnel)
            await this.loadSitePerformance();

            const s = stats.stats;
            // Keep a full-ish pool for the activity chart
            this.adminArticles = (dashData && dashData.recentArticles) || recentArticles.articles || [];

            this.countUp(document.getElementById('statTotalArticles'), s.totalArticles);
            this.countUp(document.getElementById('statPublished'), s.publishedArticles);
            this.countUp(document.getElementById('statDrafts'), s.draftArticles);
            this.countUp(document.getElementById('statUsers'), s.totalUsers);
            this.countUp(document.getElementById('statComments'), s.totalComments);

            const draftShare = s.totalArticles ? Math.round((s.draftArticles / s.totalArticles) * 100) : 0;
            const pubShare = s.totalArticles ? Math.round((s.publishedArticles / s.totalArticles) * 100) : 0;

            const trends = {
                statTotalTrend: `${s.totalArticles} in the system`,
                statPublishedTrend: `${pubShare}% of all articles`,
                statDraftsTrend: `${draftShare}% awaiting review`,
                statUsersTrend: `${(dashData && dashData.recentUsers ? dashData.recentUsers.length : 0)} most recent`,
                statCommentsTrend: s.totalComments === 0 ? 'queue is clear' : 'needs a look'
            };
            Object.keys(trends).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = trends[id];
            });

            this.renderActivityChart();
            this.renderActivityFeed(s, recentArticles.articles, dashData && dashData.recentUsers);

            const tbody = document.getElementById('recentArticlesTable');
            if (tbody) tbody.innerHTML = this.recentRows(recentArticles.articles);
        } catch (error) {
            console.error('Error loading dashboard:', error);
            this.failCell('recentArticlesTable', 6, 'Could not load recent activity.');
        }
    }

    recentRows(articles) {
        if (!articles || articles.length === 0) {
            return '<tr><td colspan="6" style="text-align:center;color:var(--text-faint)">No articles yet.</td></tr>';
        }
        return articles.map(a => `
            <tr>
                <td><a href="/article?slug=${encodeURIComponent(a.slug)}"><b>${this.esc(a.title)}</b></a></td>
                <td>${this.esc(a.category_name || '—')}</td>
                <td>${this.esc(a.author_name || '—')}</td>
                <td>${this.statusBadge(a.status)}</td>
                <td>${this.formatDate(a.updated_at || a.created_at)}</td>
                <td><div class="cell-actions">
                    <button class="btn--icon" title="Edit" aria-label="Edit" onclick="app.editArticle(${a.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                    </button>
                    <button class="btn--icon" title="Delete" aria-label="Delete" onclick="app.deleteArticle(${a.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div></td>
            </tr>`).join('');
    }

    statusBadge(status) {
        const map = {
            published: 'badge--ok',
            draft: 'badge--warn',
            archived: 'badge--err'
        };
        return `<span class="badge ${map[status] || ''}">${this.esc(status || 'unknown')}</span>`;
    }

    async loadAllArticles() {
        try {
            const [recent, site] = await Promise.all([
                api.getRecentArticles(),
                api.getSiteStats(14).catch(() => null)
            ]);
            this.adminArticles = recent.articles || [];

            // Merge the impression/click funnel into the rows
            const funnel = {};
            ((site && site.articles) || []).forEach(a => {
                funnel[a.id] = { impressions: a.impressions, clicks: a.clicks, ctr: a.ctr };
            });
            this.adminArticles.forEach(a => {
                const f = funnel[a.id];
                if (f) {
                    a.impressions = f.impressions;
                    a.clicks = f.clicks;
                    a.ctr = f.ctr;
                }
            });

            this.applyArticleFilters();
        } catch (error) {
            console.error('Error loading articles:', error);
            this.failCell('allArticlesTable', 8, 'Could not load articles.');
        }
    }

    applyArticleFilters() {
        const tbody = document.getElementById('allArticlesTable');
        if (!tbody) return;

        const query = (document.getElementById('articleSearch')?.value || '').toLowerCase().trim();
        const status = document.getElementById('articleStatusFilter')?.value || '';

        const rows = (this.adminArticles || []).filter(a => {
            const matchesQuery = !query
                || a.title.toLowerCase().includes(query)
                || (a.author_name || '').toLowerCase().includes(query)
                || (a.category_name || '').toLowerCase().includes(query);
            const matchesStatus = !status || a.status === status;
            return matchesQuery && matchesStatus;
        });

        tbody.innerHTML = rows.length === 0
            ? '<tr><td colspan="6" class="empty-cell">No articles match these filters.</td></tr>'
            : this.recentRows(rows);
    }

    async loadCategories() {
        try {
            const data = await api.getCategories();
            this.adminCategories = data.categories || [];
            this.applyCategoryFilter();
        } catch (error) {
            console.error('Error loading categories:', error);
            this.failCell('categoriesTable', 4, 'Could not load sections.');
        }
    }

    applyCategoryFilter() {
        const tbody = document.getElementById('categoriesTable');
        if (!tbody) return;
        const cats = this.adminCategories || [];

        tbody.innerHTML = cats.length === 0
            ? '<tr><td colspan="4" class="empty-cell">No sections yet.</td></tr>'
            : cats.map(cat => `
                <tr>
                    <td><b>${this.esc(cat.name)}</b></td>
                    <td>${this.esc(cat.slug)}</td>
                    <td>${this.esc(cat.description || '—')}</td>
                    <td><div class="cell-actions">
                        <button class="btn--icon" title="Edit" aria-label="Edit" onclick="app.openCategoryModal(app.adminCategories.find(c => c.id === ${cat.id}))">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="btn--icon danger" title="Delete" aria-label="Delete" onclick="app.deleteCategory(${cat.id})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div></td>
                </tr>`).join('');
    }

    async loadComments() {
        try {
            const data = await api.getManagedComments();
            this.adminComments = data.comments || [];
            this.applyCommentFilter();
        } catch (error) {
            console.error('Error loading comments:', error);
            this.failCell('commentsTable', 5, 'Could not load comments.');
        }
    }

    async moderateComment(id, status) {
        try {
            await api.updateCommentStatus(id, status);
            this.showToast('Comment updated.', 'success');
            this.loadComments();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deleteComment(id) {
        if (!confirm('Delete this comment permanently?')) return;
        try {
            await api.deleteComment(id);
            this.showToast('Comment deleted.', 'success');
            this.loadComments();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    /* Show a clear failure state instead of leaving a section stuck on
       "Loading…" when a request fails.
       Renders a table row for table bodies, a plain block otherwise. */
    failCell(id, colspan, message) {
        const el = document.getElementById(id);
        if (!el) return;
        const text = this.esc(message);
        if (el.tagName === 'TBODY') {
            el.innerHTML = `<tr><td colspan="${colspan}" class="empty-cell">${text}</td></tr>`;
        } else {
            el.innerHTML = `<div class="empty-cell" style="display:block">${text}</div>`;
        }
    }

    async loadUsers() {
        try {
            const data = await api.getUsers();
            this.adminUsers = data.users || [];
            this.applyUserFilter();
        } catch (error) {
            console.error('Error loading users:', error);
            this.failCell('usersTable', 5, 'Could not load users.');
        }
    }

    applyUserFilter() {
        const tbody = document.getElementById('usersTable');
        if (!tbody) return;

        const role = document.getElementById('userRoleFilter')?.value || '';
        const users = (this.adminUsers || []).filter(u => !role || u.role === role);
        const roleClass = { superadmin: 'badge--iris', admin: 'badge--info', writer: 'badge--ok', reader: '' };

        tbody.innerHTML = users.length === 0
            ? '<tr><td colspan="5" class="empty-cell">No users match this filter.</td></tr>'
            : users.map(user => `
                <tr>
                    <td>
                        <div style="display:flex;align-items:center;gap:.6rem">
                            <span class="avatar avatar--sm">${this.esc((user.name || 'U').charAt(0))}</span>
                            <b>${this.esc(user.name)}</b>
                        </div>
                    </td>
                    <td>${this.esc(user.email)}</td>
                    <td><span class="badge ${roleClass[user.role] || ''}">${this.esc(user.role)}</span></td>
                    <td>${this.formatDate(user.created_at)}</td>
                    <td><div class="cell-actions">
                        <button class="btn--icon" title="Edit role" aria-label="Edit role" onclick="app.openUserModal(app.adminUsers.find(u => u.id === ${user.id}))">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="btn--icon danger" title="Delete" aria-label="Delete" onclick="app.deleteUser(${user.id})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div></td>
                </tr>`).join('');
    }

    /* ============================================
       ADVERT SPACES — one uploader + link per slot
       ============================================ */
    async loadAds() {
        const wrap = document.getElementById('adsSlots');
        if (!wrap) return;

        try {
            const data = await api.getManagedAds();
            this.adminAds = data.ads || [];
            this.renderAdSlots();
        } catch (error) {
            console.error('Error loading advert spaces:', error);
                this.failCell('adsSlots', 1, 'Could not load advert spaces.');
            wrap.innerHTML = '<div class="empty-cell">Could not load advert spaces.</div>';
        }

        await this.loadAdPerformance();
    }

    /* ---------------- Performance: CTR + chart ---------------- */
    async loadAdPerformance() {
        try {
            const data = await api.getAdStats(14);
            this.adStats = data;
            this.renderAdPerformance(data);
        } catch (error) {
            console.error('Error loading ad performance:', error);
        }
    }

    renderAdPerformance(data) {
        const impressionsEl = document.getElementById('perfImpressions');
        const clicksEl = document.getElementById('perfClicks');
        const ctrEl = document.getElementById('perfCtr');
        const topEl = document.getElementById('perfTop');
        const select = document.getElementById('perfSlot');
        const chart = document.getElementById('perfChart');
        const chartEmpty = document.getElementById('perfChartEmpty');
        const tbody = document.getElementById('perfTable');

        if (!impressionsEl || !data) return;

        const t = data.totals || { impressions: 0, clicks: 0, ctr: 0 };
        this.countUp(impressionsEl, t.impressions || 0);
        this.countUp(clicksEl, t.clicks || 0);

        const ctr = (t.ctr || 0).toFixed(2) + '%';
        if (ctrEl) ctrEl.textContent = ctr;

        // Best placement by clicks (falls back to impressions)
        const placements = Object.values(data.placements || {});
        let best = null;
        placements.forEach(p => {
            const score = p.clicks * 1000 + p.impressions;
            if (!best || score > best._score) {
                best = Object.assign({}, p, { _score: score });
            }
        });
        if (topEl) {
            topEl.textContent = best && (best.clicks > 0 || best.impressions > 0)
                ? best.name
                : '—';
        }

        // Populate the slot picker once
        if (select && select.options.length <= 1) {
            placements.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.position;
                opt.textContent = p.name;
                select.appendChild(opt);
            });
            select.addEventListener('change', () => this.renderAdChart(data));
        }

        this.renderAdChart(data);
        this.renderAdPerfTable(data);
    }

    renderAdChart(data) {
        const chart = document.getElementById('perfChart');
        const empty = document.getElementById('perfChartEmpty');
        const select = document.getElementById('perfSlot');
        if (!chart) return;

        const wanted = select ? select.value : 'all';
        const placements = data.placements || {};

        // "All placements" sums every slot per day
        const dates = [];
        let series = [];

        if (wanted === 'all') {
            const acc = {};
            Object.values(placements).forEach(p => {
                p.series.forEach(row => {
                    if (!acc[row.date]) acc[row.date] = { impressions: 0, clicks: 0 };
                    acc[row.date].impressions += row.impressions;
                    acc[row.date].clicks += row.clicks;
                });
            });
            Object.keys(acc).sort().forEach(d => {
                dates.push(d);
                series.push(acc[d]);
            });
        } else {
            const p = placements[wanted];
            if (p) {
                p.series.forEach(row => {
                    dates.push(row.date);
                    series.push(row);
                });
            }
        }

        const totalImp = series.reduce((s, r) => s + r.impressions, 0);
        const totalClk = series.reduce((s, r) => s + r.clicks, 0);

        if (empty) empty.style.display = (totalImp + totalClk) === 0 ? 'block' : 'none';
        chart.style.display = (totalImp + totalClk) === 0 ? 'none' : 'flex';

        if (series.length === 0) {
            chart.innerHTML = '';
            return;
        }

        const max = Math.max(
            ...series.map(r => Math.max(r.impressions, r.clicks)),
            1
        );

        chart.innerHTML = series.map((row, i) => {
            const d = new Date(dates[i]);
            const label = isNaN(d.getTime())
                ? dates[i]
                : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const impH = Math.max(2, (row.impressions / max) * 100);
            const clkH = Math.max(2, (row.clicks / max) * 100);

            return `
                <div class="chart__col" title="${label}: ${row.impressions} impressions, ${row.clicks} clicks">
                    <div class="chart__pair">
                        <div class="chart__bar chart__bar--imp" style="height:${impH}%"><span>${row.impressions}</span></div>
                        <div class="chart__bar chart__bar--clk" style="height:${clkH}%"><span>${row.clicks}</span></div>
                    </div>
                    <div class="chart__label">${label}</div>
                </div>`;
        }).join('');

        // Grow the bars in
        requestAnimationFrame(() => {
            chart.querySelectorAll('.chart__bar').forEach(bar => {
                const h = bar.style.height;
                bar.style.height = '2%';
                requestAnimationFrame(() => { bar.style.height = h; });
            });
        });
    }

    renderAdPerfTable(data) {
        const tbody = document.getElementById('perfTable');
        if (!tbody) return;

        const placements = Object.values(data.placements || {});
        if (placements.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No placements.</td></tr>';
            return;
        }

        tbody.innerHTML = placements.map(p => `
            <tr>
                <td><b>${this.esc(p.name)}</b></td>
                <td>${p.impressions}</td>
                <td>${p.clicks}</td>
                <td class="ctr-cell">${(p.ctr || 0).toFixed(2)}%</td>
            </tr>`).join('');
    }

    renderAdSlots() {
        const wrap = document.getElementById('adsSlots');
        if (!wrap) return;

        if (!this.adminAds || this.adminAds.length === 0) {
            wrap.innerHTML = '<div class="empty-cell">No advert spaces configured.</div>';
            return;
        }

        wrap.innerHTML = this.adminAds.map(ad => `
            <div class="adslot" data-slot="${this.esc(ad.position)}">
                <div class="adslot__head">
                    <div>
                        <b>${this.esc(ad.name)}</b>
                        <span class="adslot__label">${this.esc(ad.label || ad.position)}</span>
                    </div>
                    <label class="adslot__toggle">
                        <input type="checkbox" data-ad-active ${ad.is_active ? 'checked' : ''}
                               aria-label="Toggle ${this.esc(ad.name)}">
                        <span class="adslot__switch"></span>
                        <span>${ad.is_active ? 'Live' : 'Off'}</span>
                    </label>
                </div>
                ${(!ad.is_active && ad.image_url && ad.link_url) ? `
                <div class="adslot__warn">
                    This banner is ready but switched off — flip the switch to <b>Live</b> to show it on the site.
                </div>` : ''}

                <div class="adslot__body">
                    <div class="adslot__preview" data-ad-drop>
                        <img src="${this.esc(ad.image_url) || ''}" alt=""
                             style="${ad.image_url ? '' : 'display:none'}">
                        <div class="adslot__empty" style="${ad.image_url ? 'display:none' : ''}">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <path d="M17 8l-5-5-5 5"></path><path d="M12 3v12"></path>
                            </svg>
                            <b>Drop image</b>
                            <span>or click to browse</span>
                        </div>
                        <div class="adslot__spin" style="display:none"><span class="spinner"></span></div>
                    </div>

                    <div class="adslot__form">
                        <div class="field">
                            <label>Link to</label>
                            <input type="url" data-ad-link value="${this.esc(ad.link_url) || ''}"
                                   placeholder="https://example.com">
                            <span class="field__hint">Where readers go when they click the banner.</span>
                        </div>
                        <div class="adslot__actions">
                            <button class="btn btn--sm btn--solid" data-ad-save>Save</button>
                            <button class="btn btn--sm btn--ghost" data-ad-clear>Remove image</button>
                            <span class="adslot__status" data-ad-status></span>
                        </div>
                    </div>
                </div>
                <input type="file" accept="image/*" hidden data-ad-file>
            </div>`).join('');

        this.bindAdSlots();
    }

    bindAdSlots() {
        document.querySelectorAll('.adslot').forEach(slot => {
            const position = slot.dataset.slot;
            // Live image for this slot; kept in sync by the uploader and the
            // remove button so Save always persists what the user sees.
            let currentImage = null;
            const fileInput = slot.querySelector('[data-ad-file]');
            const drop = slot.querySelector('[data-ad-drop]');
            const img = slot.querySelector('.adslot__empty') ?
                slot.querySelector('img') : null;
            const empty = slot.querySelector('.adslot__empty');
            const spin = slot.querySelector('.adslot__spin');
            const linkField = slot.querySelector('[data-ad-link]');
            const saveBtn = slot.querySelector('[data-ad-save]');
            const clearBtn = slot.querySelector('[data-ad-clear]');
            const activeToggle = slot.querySelector('[data-ad-active]');
            const status = slot.querySelector('[data-ad-status]');

            const existingImg = img && img.getAttribute('src');
            currentImage = existingImg || null;

            const pick = () => fileInput.click();
            drop.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                pick();
            });

            fileInput.addEventListener('change', () => {
                if (fileInput.files && fileInput.files[0]) {
                    this.uploadAdImage(position, fileInput.files[0], {
                        img, empty, spin, status,
                        onDone: (url) => { currentImage = url; }
                    });
                }
                fileInput.value = '';
            });

            ['dragenter', 'dragover'].forEach(evt => {
                drop.addEventListener(evt, (e) => {
                    e.preventDefault();
                    drop.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach(evt => {
                drop.addEventListener(evt, (e) => {
                    e.preventDefault();
                    drop.classList.remove('is-dragover');
                });
            });
            drop.addEventListener('drop', (e) => {
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) {
                    this.uploadAdImage(position, file, {
                        img, empty, spin, status,
                        onDone: (url) => { currentImage = url; }
                    });
                }
            });

            saveBtn.addEventListener('click', async () => {
                const payload = {
                    image_url: currentImage,
                    link_url: linkField.value.trim(),
                    is_active: activeToggle.checked
                };
                saveBtn.disabled = true;
                status.textContent = 'Saving…';
                try {
                    await api.updateAd(position, payload);
                    const slotData = this.adminAds.find(a => a.position === position);
                    if (slotData) {
                        slotData.link_url = payload.link_url;
                        slotData.is_active = payload.is_active;
                        slotData.image_url = payload.image_url;
                    }
                    this.renderAdSlots();
                    status.textContent = 'Saved';
                    // Explain the two reasons a saved ad may not appear
                    if (activeToggle.checked && !payload.link_url) {
                        status.textContent = 'Saved — add a link to show it';
                    } else if (activeToggle.checked && !payload.image_url) {
                        status.textContent = 'Saved — upload an image to show it';
                    }
                    setTimeout(() => { status.textContent = ''; }, 2500);
                } catch (error) {
                    status.textContent = error.message || 'Save failed';
                } finally {
                    saveBtn.disabled = false;
                }
            });

            activeToggle.addEventListener('change', () => {
                const label = activeToggle.closest('.adslot__toggle').querySelector('span:last-child');
                if (label) label.textContent = activeToggle.checked ? 'Live' : 'Off';
            });

            clearBtn.addEventListener('click', async () => {
                clearBtn.disabled = true;
                status.textContent = 'Removing…';
                try {
                    await api.updateAd(position, { image_url: null });
                    currentImage = null;
                    const slotData = this.adminAds.find(a => a.position === position);
                    if (slotData) slotData.image_url = null;
                    img.removeAttribute('src');
                    img.style.display = 'none';
                    empty.style.display = 'flex';
                    status.textContent = 'Image removed';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                } catch (error) {
                    status.textContent = error.message || 'Could not remove';
                } finally {
                    clearBtn.disabled = false;
                }
            });
        });
    }

    async uploadAdImage(position, file, ui) {
        if (!window.ImageCropper) {
            this.showToast('Image cropper failed to load.', 'error');
            return;
        }

        // SVG carries scripts, so it is not accepted as an ad creative
        if (file.type === 'image/svg+xml') {
            ui.status.textContent = 'SVG cannot be used — export as PNG or JPG';
            return;
        }

        // Banners are wide; the rail and in-feed slots are closer to 4:3
        const aspect = (position === 'rail' || position === 'inline') ? 4 / 3 : 6 / 1;

        window.ImageCropper.open(file, async (croppedFile) => {
            ui.spin.style.display = 'flex';
            ui.status.textContent = 'Uploading…';
            try {
                const result = await api.uploadImage(croppedFile);

                // Persist straight away, so the ad is never "uploaded but lost"
                await api.updateAd(position, { image_url: result.url });
                if (ui.onDone) ui.onDone(result.url);

                ui.img.src = result.url;
                ui.img.style.display = 'block';
                ui.empty.style.display = 'none';

                const slotData = this.adminAds.find(a => a.position === position);
                if (slotData) slotData.image_url = result.url;

                ui.status.textContent = 'Image saved — add a link and hit Save';
            } catch (error) {
                ui.status.textContent = error.message || 'Upload failed';
            } finally {
                ui.spin.style.display = 'none';
            }
        }, aspect);
    }

    // ============================================
    // ARTICLE MANAGEMENT
    // ============================================
    openArticleModal(article = null) {
        const modal = document.getElementById('articleModal');
        const form = document.getElementById('articleForm');
        const title = document.getElementById('articleModalTitle');

        // Populate categories dropdown
        const categorySelect = document.getElementById('articleCategory');
        if (categorySelect) {
            categorySelect.innerHTML = this.categories.map(cat =>
                `<option value="${cat.id}">${cat.name}</option>`
            ).join('');
        }

        if (article) {
            title.textContent = 'Edit Article';
            document.getElementById('articleId').value = article.id;
            document.getElementById('articleTitle').value = article.title;
            document.getElementById('articleExcerpt').value = article.excerpt || '';
            document.getElementById('articleContent').value = article.content || '';
            document.getElementById('articleStatus').value = article.status || 'draft';
            document.getElementById('articleTags').value = article.tags || '';
            this.setCoverImage(article.featured_image || '');
        } else {
            title.textContent = 'New Article';
            form.reset();
            document.getElementById('articleId').value = '';
            document.getElementById('articleTags').value = '';
            this.setCoverImage('');
        }

        this.openModal('articleModal');
    }


    /* Insert a social/video embed at the end of the article body */
    async insertEmbed() {
        const input = document.getElementById('embedUrl');
        const hint = document.getElementById('embedHint');
        const btn = document.getElementById('embedInsertBtn');
        const body = document.getElementById('articleContent');
        if (!input || !body) return;

        const url = input.value.trim();
        if (!url) {
            if (hint) { hint.textContent = 'Paste a URL first.'; hint.className = 'field__hint is-error'; }
            return;
        }

        if (btn) btn.disabled = true;
        if (hint) { hint.textContent = 'Checking link…'; hint.className = 'field__hint'; }

        try {
            const res = await fetch('/api/embed/resolve?url=' + encodeURIComponent(url), {
                headers: { Accept: 'application/json' }
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || data.error) {
                if (hint) { hint.textContent = data.error || 'That URL cannot be embedded.'; hint.className = 'field__hint is-error'; }
                return;
            }

            const marker = `<div class="embed" data-embed="${this.esc(data.url)}"></div>`;
            const current = body.value.trim();
            body.value = current ? `${current}\n\n${marker}` : marker;
            input.value = '';
            if (hint) {
                hint.textContent = `Embed added (${data.label || data.provider}).`;
                hint.className = 'field__hint is-ok';
            }
        } catch (error) {
            if (hint) { hint.textContent = 'Could not reach the embed service.'; hint.className = 'field__hint is-error'; }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async handleArticleSave(e) {
        e.preventDefault();

        // Prefer an uploaded image; fall back to a pasted URL
        const pastedUrl = document.getElementById('articleImageUrl').value.trim();
        const featuredImage = document.getElementById('articleImage').value.trim() || pastedUrl;

        const id = document.getElementById('articleId').value;
        const data = {
            title: document.getElementById('articleTitle').value,
            excerpt: document.getElementById('articleExcerpt').value,
            content: document.getElementById('articleContent').value,
            category_id: document.getElementById('articleCategory').value,
            status: document.getElementById('articleStatus').value,
            featured_image: featuredImage,
            tags: document.getElementById('articleTags').value
        };

        try {
            if (id) {
                await api.updateArticle(id, data);
                this.showToast('Article updated successfully', 'success');
            } else {
                await api.createArticle(data);
                this.showToast('Article created successfully', 'success');
            }

            this.closeModal('articleModal');
            await this.loadInitialData();
            this.loadAllArticles();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async editArticle(id) {
        // Drafts are not in the public list, so look in the desk data first,
        // then ask the server directly.
        let article = (this.adminArticles || []).find(a => a.id == id)
            || this.articles.find(a => a.id == id);

        if (!article) {
            try {
                const data = await api.getArticleForEdit(id);
                article = data.article;
            } catch (error) {
                console.error('Could not load article for editing:', error);
            }
        }

        if (!article) {
            this.showToast('Could not load that article.', 'error');
            return;
        }

        // Sections must be loaded before the editor dropdown is filled
        if (!this.categories || this.categories.length === 0) {
            try {
                const cats = await api.getCategories();
                this.categories = cats.categories || [];
            } catch (error) {
                console.error('Could not load sections:', error);
            }
        }

        this.openArticleModal(article);
    }

    async deleteArticle(id) {
        if (!confirm('Are you sure you want to delete this article?')) return;

        try {
            await api.deleteArticle(id);
            this.showToast('Article deleted', 'success');
            await this.loadInitialData();
            this.loadAllArticles();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // ============================================
    // USER MANAGEMENT
    // ============================================
    openUserModal(user = null) {
        const form = document.getElementById('userForm');
        const title = document.getElementById('userModalTitle');
        const submit = document.getElementById('userSubmitBtn');
        const hint = document.getElementById('userPasswordHint');
        const passwordField = document.getElementById('userPassword');

        if (user) {
            title.textContent = `Edit ${user.name}`;
            submit.textContent = 'Save changes';
            document.getElementById('userId').value = user.id;
            document.getElementById('userName').value = user.name;
            document.getElementById('userEmail').value = user.email;
            document.getElementById('userRole').value = user.role;
            passwordField.value = '';
            passwordField.removeAttribute('required');
            if (hint) hint.textContent = 'Leave blank to keep the current password.';
        } else {
            title.textContent = 'New user';
            submit.textContent = 'Create user';
            form.reset();
            document.getElementById('userId').value = '';
            passwordField.setAttribute('required', 'required');
            if (hint) hint.textContent = 'Required when creating a user.';
        }

        this.openModal('userModal');
    }

    async handleUserSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('userId').value;
        const name = document.getElementById('userName').value.trim();
        const email = document.getElementById('userEmail').value.trim();
        const role = document.getElementById('userRole').value;
        const password = document.getElementById('userPassword').value;

        if (!name || !email) {
            this.showToast('Name and email are required.', 'error');
            return;
        }

        try {
            if (id) {
                await api.updateUserRole(id, role);
                this.showToast(`${name} is now ${role}.`, 'success');
            } else {
                if (!password || password.length < 6) {
                    this.showToast('Password must be at least 6 characters.', 'error');
                    return;
                }
                await api.register(email, name, password, role);
                this.showToast(`${name} created as ${role}.`, 'success');
            }
            this.closeModal('userModal');
            this.loadUsers();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deleteUser(id) {
        if (!confirm('Delete this user? Their articles stay published.')) return;

        try {
            await api.deleteUser(id);
            this.showToast('User deleted.', 'success');
            this.loadUsers();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // ============================================
    // CATEGORY MANAGEMENT
    // ============================================
    openCategoryModal(cat = null) {
        const form = document.getElementById('categoryForm');
        const title = document.getElementById('categoryModalTitle');
        const submit = document.getElementById('categorySubmitBtn');
        const slugField = document.getElementById('categorySlug');
        const nameField = document.getElementById('categoryName');

        if (cat) {
            title.textContent = `Edit ${cat.name}`;
            submit.textContent = 'Save changes';
            document.getElementById('categoryId').value = cat.id;
            nameField.value = cat.name;
            slugField.value = cat.slug;
            document.getElementById('categoryDescription').value = cat.description || '';
        } else {
            title.textContent = 'New section';
            submit.textContent = 'Create section';
            form.reset();
            document.getElementById('categoryId').value = '';
            // Auto-suggest a slug from the name as it is typed
            nameField.oninput = () => {
                if (!document.getElementById('categoryId').value) {
                    slugField.value = nameField.value.toLowerCase().trim()
                        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                }
            };
        }

        this.openModal('categoryModal');
    }

    async handleCategorySubmit(e) {
        e.preventDefault();
        const id = document.getElementById('categoryId').value;
        const payload = {
            name: document.getElementById('categoryName').value.trim(),
            slug: document.getElementById('categorySlug').value.trim().toLowerCase()
                .replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''),
            description: document.getElementById('categoryDescription').value.trim()
        };

        if (!payload.name || !payload.slug) {
            this.showToast('Name and slug are required.', 'error');
            return;
        }

        try {
            if (id) {
                await api.updateCategory(id, payload);
                this.showToast('Section updated.', 'success');
            } else {
                await api.createCategory(payload);
                this.showToast('Section created.', 'success');
            }
            this.closeModal('categoryModal');
            this.loadCategories();
            await this.loadInitialData();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deleteCategory(id) {
        if (!confirm('Delete this section? Articles in it become unsectioned.')) return;

        try {
            await api.deleteCategory(id);
            this.showToast('Section deleted.', 'success');
            this.loadCategories();
            await this.loadInitialData();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // ============================================
    // AD MANAGEMENT
    // ============================================



    // ============================================
    // SETTINGS
    // ============================================
    async saveSettings() {
        try {
            await api.updateSetting('siteName', document.getElementById('settingSiteName').value);
            await api.updateSetting('siteDescription', document.getElementById('settingSiteDescription').value);
            await api.updateSetting('contactEmail', document.getElementById('settingContactEmail').value);

            this.showToast('Settings saved successfully', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    /* ============================================
       COVER IMAGE UPLOADER (crop → upload)
       ============================================ */
    setCoverImage(url) {
        const hidden = document.getElementById('articleImage');
        const pasted = document.getElementById('articleImageUrl');
        const img = document.getElementById('coverPreviewImg');
        const empty = document.getElementById('coverEmpty');
        const removeBtn = document.getElementById('coverRemoveBtn');
        const status = document.getElementById('coverStatus');

        if (hidden) hidden.value = url || '';
        if (pasted) pasted.value = url && url.startsWith('http') ? url : '';
        if (status) status.textContent = '';

        if (url) {
            if (img) { img.src = url; img.style.display = 'block'; }
            if (empty) empty.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        } else {
            if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
            if (empty) empty.style.display = 'flex';
            if (removeBtn) removeBtn.style.display = 'none';
        }
    }

    bindCoverUploader() {
        const box = document.getElementById('coverUploader');
        const input = document.getElementById('coverInput');
        const chooseBtn = document.getElementById('coverChooseBtn');
        const removeBtn = document.getElementById('coverRemoveBtn');
        const spinner = document.getElementById('coverSpinner');
        const status = document.getElementById('coverStatus');
        if (!box || !input) return;

        const pick = () => input.click();
        box.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            pick();
        });
        if (chooseBtn) chooseBtn.addEventListener('click', pick);

        input.addEventListener('change', () => {
            if (input.files && input.files[0]) this.cropAndUpload(input.files[0]);
            input.value = '';
        });

        // Drag & drop straight onto the dropzone
        ['dragenter', 'dragover'].forEach(evt => {
            box.addEventListener(evt, (e) => {
                e.preventDefault();
                box.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach(evt => {
            box.addEventListener(evt, (e) => {
                e.preventDefault();
                box.classList.remove('is-dragover');
            });
        });
        box.addEventListener('drop', (e) => {
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) this.cropAndUpload(file);
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setCoverImage('');
            });
        }

        this._coverSpinner = spinner;
        this._coverStatus = status;
    }

    async cropAndUpload(file) {
        if (!window.ImageCropper) {
            this.showToast('Image cropper failed to load.', 'error');
            return;
        }

        window.ImageCropper.open(file, async (croppedFile) => {
            const spinner = document.getElementById('coverSpinner');
            const status = document.getElementById('coverStatus');
            const empty = document.getElementById('coverEmpty');

            if (spinner) spinner.style.display = 'flex';
            if (empty) empty.style.display = 'none';
            if (status) status.textContent = '';

            try {
                const result = await api.uploadImage(croppedFile);
                this.setCoverImage(result.url);
                this.showToast('Cover image uploaded.', 'success');
            } catch (error) {
                this.showToast(error.message || 'Upload failed.', 'error');
                if (empty) empty.style.display = 'flex';
            } finally {
                if (spinner) spinner.style.display = 'none';
            }
        });
    }

    initScrollProgress() {
        const bar = document.getElementById('scrollProgress');
        const root = document.documentElement;
        if (!bar || !root) return;
        const update = () => {
            const max = root.scrollHeight - window.innerHeight;
            const pct = max > 0 ? Math.min(100, (window.pageYOffset / max) * 100) : 0;
            bar.style.width = `${pct}%`;
        };
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        update();
    }

    /* Split the lead headline into per-word reveal spans */
    /* Split the lead headline into per-word reveal spans
       WITHOUT destroying the anchor inside it. */
    initHeadlineReveal() {
        const title = document.querySelector('.lead__title');
        if (!title || title.dataset.split === '1') return;

        const link = title.querySelector('a');
        const text = (link ? link.textContent : title.textContent).trim();
        const words = text.split(/\s+/).filter(Boolean)
            .map(w => `<span class="w">${this.esc(w)}</span>`)
            .join(' ');

        if (link) {
            // Keep the <a> so the whole headline stays clickable
            link.innerHTML = words;
        } else {
            title.innerHTML = words;
        }

        title.classList.add('reveal-words');
        title.dataset.split = '1';
        requestAnimationFrame(() => title.classList.add('is-in'));
    }

    /* ============================================
       SEARCH
       ============================================ */
    // SEARCH
    // ============================================
    async performSearch() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) return;

        try {
            const data = await api.getArticles({ search: query });
            this.articles = data.articles || [];
            this.setCategory('all', { push: false });
            this.showToast(`Found ${this.articles.length} articles`, 'info');
        } catch (error) {
            this.showToast('Search failed', 'error');
        }
    }

    // ============================================
    // UI HELPERS
    // ============================================
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            requestAnimationFrame(() => modal.classList.add('is-open'));
            this.lockScroll(true);
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('is-open');
            setTimeout(() => { modal.style.display = 'none'; }, 320);
            // Only unlock when nothing else is open
            const stillOpen = document.querySelector('.modal.is-open, .admin.is-open, .cropper.is-open');
            if (!stillOpen) this.lockScroll(false);
        }
    }

    /* Prevent the page behind an overlay from scrolling */
    lockScroll(on) {
        const openElsewhere = document.querySelector('.modal.is-open, .admin.is-open, .cropper.is-open');
        document.body.style.overflow = (on || openElsewhere) ? 'hidden' : '';
    }

    showToast(message, type = 'info') {
        const container = document.querySelector('.toast-container') || this.createToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="Dismiss">&times;</button>
        `;

        toast.querySelector('.toast-close')?.addEventListener('click', () => toast.remove());
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 5000);
    }

    createToastContainer() {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    readArticle(slug) {
        window.location.href = `/article?slug=${encodeURIComponent(slug)}`;
    }

    // ============================================
    // SCROLL EFFECTS
    // ============================================
    initScrollEffects() {
        const header = document.getElementById('siteHeader');
        if (!header) return;

        const onScroll = () => {
            header.classList.toggle('is-scrolled', window.pageYOffset > 10);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }
}

// Initialize app
app = null;
try {
    console.log('Initializing RedhanApp...');
    app = new RedhanApp();
    console.log('RedhanApp initialized');
} catch (error) {
    console.error('Failed to initialize app:', error);
}
