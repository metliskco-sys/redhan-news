// ============================================
// API CLIENT
// ============================================
const API_BASE = '';

class ApiClient {
    constructor() {
        this.baseUrl = API_BASE;
        this.token = localStorage.getItem('token');
    }

    setToken(token) {
        this.token = token;
        if (token) {
            localStorage.setItem('token', token);
        } else {
            localStorage.removeItem('token');
        }
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}/api${endpoint}`;
        const config = {
            ...options,
            headers: {
                ...this.getHeaders(),
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                // A stale or invalid session must not leave the desk silently
                // broken: drop it and bounce to sign-in.
                if (response.status === 401 && this.token) {
                    const onLoginPage = window.location.pathname === '/login';
                    if (!onLoginPage) {
                        this.setToken(null);
                        localStorage.removeItem('user');
                        window.location.replace('/login');
                        throw new Error('Session expired');
                    }
                }
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            if (error.message !== 'Session expired') {
                console.error('API Error:', error);
            }
            throw error;
        }
    }

    // Auth endpoints
    async login(email, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    }

    async signup(email, name, password) {
        return this.request('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, name, password })
        });
    }

    async register(email, name, password, role = 'writer') {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, name, password, role })
        });
    }

    async getProfile() {
        return this.request('/auth/profile');
    }

    async updateProfile(data) {
        return this.request('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async getUsers() {
        return this.request('/auth/users');
    }

    async updateUserRole(userId, role) {
        return this.request(`/auth/users/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role })
        });
    }

    async deleteUser(userId) {
        return this.request(`/auth/users/${userId}`, {
            method: 'DELETE'
        });
    }

    // Articles endpoints
    async getArticles(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/articles${query ? `?${query}` : ''}`);
    }

    async getArticle(slug) {
        return this.request(`/articles/${slug}`);
    }

    async createArticle(data) {
        return this.request('/articles', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateArticle(id, data) {
        return this.request(`/articles/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteArticle(id) {
        return this.request(`/articles/${id}`, {
            method: 'DELETE'
        });
    }

    async getDashboardStats() {
        return this.request('/articles/dashboard/stats');
    }

    async getArticleForEdit(id) {
        return this.request(`/articles/manage/${id}`);
    }

    async getRecentArticles() {
        return this.request('/articles/dashboard/recent');
    }

    // Categories endpoints
    async getCategories() {
        return this.request('/categories');
    }

    async createCategory(data) {
        return this.request('/categories', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateCategory(id, data) {
        return this.request(`/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteCategory(id) {
        return this.request(`/categories/${id}`, {
            method: 'DELETE'
        });
    }

    // Comments endpoints
    async getComments(articleId) {
        return this.request(`/comments/article/${articleId}`);
    }

    async recordArticleEvent(id, type) {
        return this.request(`/articles/${id}/event`, {
            method: 'POST',
            body: JSON.stringify({ type })
        });
    }

    async recordPageView(path) {
        return this.request('/pages/event', {
            method: 'POST',
            body: JSON.stringify({ path })
        });
    }

    async getSiteStats(days = 14) {
        return this.request(`/stats/site?days=${days}`);
    }

    async getManagedComments() {
        return this.request('/comments/manage');
    }

    async createComment(articleId, data) {
        return this.request(`/comments/article/${articleId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateCommentStatus(id, status) {
        return this.request(`/comments/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
    }

    async deleteComment(id) {
        return this.request(`/comments/${id}`, {
            method: 'DELETE'
        });
    }

    // Ads endpoints
    async getAds() {
        return this.request('/ads');
    }







    // Upload
    async uploadImage(file) {
        const form = new FormData();
        form.append('image', file);

        const response = await fetch(`${this.baseUrl}/api/upload/image`, {
            method: 'POST',
            headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
            body: form
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data;
    }

    // Ads — fixed placements
    async getManagedAds() {
        return this.request('/ads/manage');
    }

    async updateAd(position, data) {
        return this.request(`/ads/${position}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async getAdStats(days = 14) {
        return this.request(`/ads/stats?days=${days}`);
    }

    // Settings endpoints
    async getSettings() {
        return this.request('/settings');
    }
    async updateSetting(key, value) {
        return this.request(`/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value })
        });
    }

    async getDashboardData() {
        return this.request('/settings/dashboard/data');
    }
}

const api = new ApiClient();
