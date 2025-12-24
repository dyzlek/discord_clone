const express = require('express');
const router = express.Router();

module.exports = (db, authMiddleware) => {
    // Search users
    router.get('/search', authMiddleware, (req, res) => {
        try {
            const { q } = req.query;
            if (!q || q.length < 2) {
                return res.json([]);
            }

            const users = db.prepare(`
        SELECT id, username, avatar, status, presence
        FROM users
        WHERE username LIKE ? AND id != ?
        LIMIT 10
      `).all(`%${q}%`, req.user.id);

            res.json(users);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get user profile
    router.get('/:id', authMiddleware, (req, res) => {
        try {
            const user = db.prepare(`
        SELECT id, username, avatar, banner, bio, custom_status, custom_status_emoji, 
               social_links, status, presence, created_at
        FROM users WHERE id = ?
      `).get(req.params.id);

            if (!user) {
                return res.status(404).json({ error: 'Utilisateur non trouvé' });
            }

            user.social_links = user.social_links ? JSON.parse(user.social_links) : {};
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Update profile
    router.put('/profile', authMiddleware, (req, res) => {
        try {
            const { username, avatar, banner, bio, custom_status, custom_status_emoji, social_links, presence } = req.body;

            const updates = [];
            const params = [];

            if (username) { updates.push('username = ?'); params.push(username); }
            if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
            if (banner !== undefined) { updates.push('banner = ?'); params.push(banner); }
            if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
            if (custom_status !== undefined) { updates.push('custom_status = ?'); params.push(custom_status); }
            if (custom_status_emoji !== undefined) { updates.push('custom_status_emoji = ?'); params.push(custom_status_emoji); }
            if (social_links !== undefined) { updates.push('social_links = ?'); params.push(JSON.stringify(social_links)); }
            if (presence) { updates.push('presence = ?'); params.push(presence); }

            if (updates.length > 0) {
                params.push(req.user.id);
                db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            }

            const user = db.prepare(`
        SELECT id, username, avatar, banner, bio, custom_status, custom_status_emoji, social_links, presence
        FROM users WHERE id = ?
      `).get(req.user.id);

            user.social_links = user.social_links ? JSON.parse(user.social_links) : {};
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
