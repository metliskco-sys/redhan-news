// ============================================
// ARTICLE DETAIL PAGE
// ============================================
(function () {
    const container = document.getElementById('articleContainer');
    if (!container) return;

    let current = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return 'Undated';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function readMinutes(html) {
        const text = String(html || '').replace(/<[^>]*>/g, ' ');
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round(words / 200));
    }

    function scrollToComments() {
        const target = document.getElementById('comments');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---------------- Share bar ---------------- */
    function shareBarMarkup() {
        const url = window.location.href;
        const title = current ? current.title : document.title;
        const text = encodeURIComponent(title);
        const via = encodeURIComponent(url);

        return `
            <div class="sharebar">
                <span class="sharebar__label">Share</span>
                <button class="btn--icon" data-share="copy" title="Copy link" aria-label="Copy link">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                </button>
                <a class="btn--icon" target="_blank" rel="noopener"
                   href="https://twitter.com/intent/tweet?text=${text}&url=${via}" title="Share on X" aria-label="Share on X">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.2 2H21l-6.5 7.4L22 22h-6.9l-4.3-6-4.9 6H2.5l7-8L2 2h6.9l4 5.6L18.2 2Zm-2.2 18h1.6L7.9 3.7H6.2L16 20Z"></path></svg>
                </a>
                <a class="btn--icon" target="_blank" rel="noopener"
                   href="https://www.facebook.com/sharer/sharer.php?u=${via}" title="Share on Facebook" aria-label="Share on Facebook">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                    </svg>
                </a>
            </div>`;
    }

    function bindShareBar() {
        const copyBtn = container.querySelector('[data-share="copy"]');
        if (!copyBtn) return;
        const original = copyBtn.innerHTML;
        const check = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"></path></svg>';

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(window.location.href);
            } catch (err) {
                // Fallback for non-secure contexts
                const tmp = document.createElement('textarea');
                tmp.value = window.location.href;
                document.body.appendChild(tmp);
                tmp.select();
                try { document.execCommand('copy'); } catch (e) { /* ignore */ }
                tmp.remove();
            }
            copyBtn.innerHTML = check;
            copyBtn.style.color = 'var(--accent)';
            setTimeout(() => { copyBtn.innerHTML = original; copyBtn.style.color = ''; }, 1500);
        });
    }

    /* ---------------- Comments ---------------- */
    function commentMarkup(c) {
        return `
            <div class="comment">
                <div class="comment__top">
                    <div class="avatar">${esc((c.author_name || 'A').charAt(0))}</div>
                    <b>${esc(c.author_name)}</b>
                    <time>${formatDate(c.created_at)}</time>
                </div>
                <p class="comment__body">${esc(c.content)}</p>
            </div>`;
    }

    function renderComments(comments) {
        const list = document.getElementById('commentList');
        const count = document.getElementById('commentCount');
        if (count) count.textContent = String(comments.length);
        if (list) {
            list.innerHTML = comments.length === 0
                ? '<p style="color:var(--text-faint);font-size:.9rem">No comments yet. Be the first to weigh in.</p>'
                : comments.map(commentMarkup).join('');
        }
    }

    function bindCommentForm() {
        const form = document.getElementById('commentForm');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                author_name: document.getElementById('commentName').value.trim(),
                author_email: document.getElementById('commentEmail').value.trim(),
                content: document.getElementById('commentBody').value.trim()
            };
            if (!payload.author_name || !payload.author_email || !payload.content) {
                alert('Please fill in your name, email and comment.');
                return;
            }
            try {
                await api.createComment(current.id, payload);
                form.reset();
                alert('Thanks — your comment is awaiting moderation.');
            } catch (error) {
                alert(error.message || 'Could not post your comment.');
            }
        });
    }

    /* Keep a slug -> id map so analytics.js can attribute clicks made from
       this page (Top Stories, related stories, back to the front page). */
    var slugMap = {};
    function rememberSlugs(list) {
        (list || []).forEach(function (a) {
            if (a && a.slug && a.id) slugMap[a.slug] = a.id;
        });
        try {
            window.__redhanSlugs = Object.assign({}, window.__redhanSlugs || {}, slugMap);
        } catch (err) { /* analytics must never break the page */ }
    }

    /* Hashtags: an author-set comma list, otherwise the section + defaults */
    function parseTags(article) {
        var raw = (article && typeof article.tags === 'string') ? article.tags : '';
        var list = raw.split(',')
            .map(function (t) { return t.trim().replace(/^#+/, '').replace(/\s+/g, ''); })
            .filter(Boolean)
            .slice(0, 8);

        if (list.length === 0) {
            list = [article.category_slug || 'news'];
            if (article.category_name) {
                list.push(article.category_name.replace(/\s+/g, ''));
            }
            list.push('Maldives');
        }
        return list;
    }

    function tagChips(article) {
        var sectionHref = '/?category=' + encodeURIComponent(article.category_slug || 'news');
        return parseTags(article).map(function (t) {
            var inSection = article.category_slug && t.toLowerCase() === article.category_slug;
            var href = inSection ? sectionHref : '/?category=' + encodeURIComponent(t.toLowerCase());
            return '<a class="tag-chip" href="' + href + '">#' + esc(t) + '</a>';
        }).join('');
    }

    /* ---------------- Render ---------------- */
    function render(article) {
        current = article;
        document.title = `${article.title} — Redhan`;
        rememberSlugs([article]);

        container.innerHTML = `
            <article class="article">
                <header class="article__head">
                    <div class="article__meta-top">
                        <span class="kicker">${esc(article.category_name || 'News')}</span>
                        <span style="font-size:.75rem;color:var(--text-faint)">${formatDate(article.published_at)}</span>
                    </div>
                    <h1 class="article__title">${esc(article.title)}</h1>
                    <p class="article__dek">${esc(article.excerpt || '')}</p>
                    <div class="article__byline">
                        <div class="avatar avatar--lg">${esc((article.author_name || 'R').charAt(0))}</div>
                        <div class="who">
                            <b>${esc(article.author_name || 'Redhan')}</b>
                            <span>Published ${formatDate(article.published_at)} · ${readMinutes(article.content)} min read</span>
                        </div>
                        ${shareBarMarkup()}
                    </div>
                </header>

                <figure class="article__hero">
                    <img src="${esc(article.featured_image) || 'https://via.placeholder.com/1200x675'}"
                         alt="" onerror="this.src='https://via.placeholder.com/1200x675'">
                </figure>

                <div class="prose">${article.content || ''}</div>

                <!-- AD: inside the story -->
                <div class="adunit adunit--article" data-ad="article">
                    <a class="adunit__link" href="#" target="_blank" rel="noopener sponsored">
                        <span class="adunit__tag">Advertisement</span>
                        <span class="adunit__cta"><b>Advertise here</b><span>Reach readers across the Maldives</span></span>
                        <img src="" alt="">
                    </a>
                </div>

                <div class="tags">
                    ${tagChips(article)}
                </div>

                <aside class="author-box">
                    <div class="avatar avatar--lg">${esc((article.author_name || 'R').charAt(0))}</div>
                    <div class="author-box__body">
                        <b>${esc(article.author_name || 'Redhan')}</b>
                        <p>Writing for Redhan across ${esc((article.category_name || 'the Maldives').toLowerCase())} and beyond. Verified, sourced reporting — every time.</p>
                    </div>
                </aside>

                <section class="related">
                    <div class="related__head">
                        <span class="kicker">Keep reading</span>
                        <hr class="rule">
                        <span style="font-size:.75rem;color:var(--text-faint)">More in ${esc(article.category_name || 'this section')}</span>
                    </div>
                    <div class="related__list" id="relatedList"></div>
                </section>

                <section class="comments" id="comments">
                    <div class="comments__head">
                        <span class="kicker">Discussion</span>
                        <h2 class="rail__title">Reader comments</h2>
                        <span class="comments__count" id="commentCount">0</span>
                    </div>
                    <div id="commentList"></div>
                    <form class="comment-form" id="commentForm">
                        <div class="field--row">
                            <div class="field">
                                <label for="commentName">Name</label>
                                <input type="text" id="commentName" required>
                            </div>
                            <div class="field">
                                <label for="commentEmail">Email</label>
                                <input type="email" id="commentEmail" required>
                            </div>
                        </div>
                        <div class="field">
                            <label for="commentBody">Comment</label>
                            <textarea id="commentBody" rows="4" placeholder="Add to the discussion…" required></textarea>
                        </div>
                        <div>
                            <button type="submit" class="btn btn--solid">Post comment</button>
                        </div>
                    </form>
                </section>
            </article>`;

        bindShareBar();
        bindCommentForm();

        // Resolve any [data-embed] placeholders in the body
        if (typeof window.renderEmbeds === 'function') {
            window.renderEmbeds(container);
        }
    }

    /* ---------------- Rail: top stories ---------------- */
    async function loadRail(excludeId) {
        try {
            const stories = await api.getArticles({ limit: 6 });

            const rail = document.getElementById('topStories');
            const list = (stories.articles || []).filter(a => a.id !== excludeId).slice(0, 5);
            rememberSlugs(list);
            if (rail) {
                rail.innerHTML = list.length === 0 ? '' : list.map((a, i) => `
                    <a class="story" href="/article?slug=${encodeURIComponent(a.slug)}">
                        <div class="story__num">${String(i + 1).padStart(2, '0')}</div>
                        <div>
                            <div class="story__title">${esc(a.title)}</div>
                            <div class="story__meta">${esc(a.category_name || 'News')} · ${formatDate(a.published_at)}</div>
                        </div>
                    </a>`).join('');
            }

        } catch (error) {
            console.error('Rail load failed:', error);
        }
    }

    async function loadRelated(article) {
        const list = document.getElementById('relatedList');
        if (!list) return;
        try {
            const data = await api.getArticles({ limit: 12 });
            const related = (data.articles || []).filter(a => a.id !== article.id);
            rememberSlugs(related);

            if (related.length === 0) {
                list.innerHTML = '<p style="color:var(--text-faint);font-size:.9rem">Nothing else filed yet.</p>';
                return;
            }

            list.innerHTML = related.slice(0, 3).map(a => `
                <a class="related-card" href="/article?slug=${encodeURIComponent(a.slug)}">
                    <img src="${esc(a.featured_image) || 'https://via.placeholder.com/240x160'}"
                         alt="" loading="lazy" onerror="this.src='https://via.placeholder.com/240x160'">
                    <div>
                        <div class="related-card__title">${esc(a.title)}</div>
                        <div class="related-card__meta">${esc(a.category_name || 'News')} · ${formatDate(a.published_at)}</div>
                    </div>
                </a>`).join('');
        } catch (error) {
            console.error('Related load failed:', error);
        }
    }

    /* ---------------- Chrome ---------------- */
    (function chrome() {
        const now = new Date();
        const dateEl = document.getElementById('todayDate');
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });
        }
        const yearEl = document.getElementById('year');
        if (yearEl) yearEl.textContent = String(now.getFullYear());
    })();

    /* ---------------- Load ---------------- */
    async function load() {
        const slug = new URLSearchParams(window.location.search).get('slug');

        if (!slug) {
            container.innerHTML = `
                <div class="state">
                    <h3>No story selected</h3>
                    <p>Open a story from the front page, or use a link like <code>/article?slug=…</code></p>
                    <a href="/" class="btn btn--sm btn--solid">Browse stories</a>
                </div>`;
            return;
        }

        try {
            const data = await api.getArticle(slug);
            render(data.article);
            loadRail(data.article.id);
            loadRelated(data.article);

            try {
                const comments = await api.getComments(data.article.id);
                renderComments(comments.comments || []);
            } catch (commentError) {
                console.error('Comments failed:', commentError);
                renderComments([]);
            }
        } catch (error) {
            container.innerHTML = `
                <div class="state">
                    <h3>Story not found</h3>
                    <p>${esc(error.message || 'This piece may have been unpublished or the link is wrong.')}</p>
                    <a href="/" class="btn btn--sm btn--solid">Back to the front page</a>
                </div>`;
        }
    }

    load();
})();
