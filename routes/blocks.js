const express = require('express');
const router = express.Router();

module.exports = (db, authMiddleware) => {
    // Get blocked users
    router.get('/', authMiddleware, (req, res) => {
        try {
            const blocks = db.prepare(`
        SELECT b.*, u.username, u.avatar
        FROM user_blocks b
        JOIN users u ON b.blocked_user_id = u.id
        WHERE b.user_id = ?
      `).all(req.user.id);
            res.json(blocks);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Block user
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { userId } = req.body;
            const id = require('crypto').randomUUID();

            // Remove from friends if exists
            db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
                .run(req.user.id, userId, userId, req.user.id);

            db.prepare('INSERT OR IGNORE INTO user_blocks (id, user_id, blocked_user_id) VALUES (?, ?, ?)')
                .run(id, req.user.id, userId);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Unblock user
    router.delete('/:userId', authMiddleware, (req, res) => {
        try {
            db.prepare('DELETE FROM user_blocks WHERE user_id = ? AND blocked_user_id = ?')
                .run(req.user.id, req.params.userId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
