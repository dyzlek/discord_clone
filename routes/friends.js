const express = require('express');
const router = express.Router();

module.exports = (db, authMiddleware, io, userSockets) => {
    // Get user's friends
    router.get('/', authMiddleware, (req, res) => {
        try {
            const friends = db.prepare(`
        SELECT f.*, u.username, u.avatar, u.status, u.presence, u.custom_status
        FROM friends f
        JOIN users u ON (f.friend_id = u.id)
        WHERE f.user_id = ? AND f.status = 'accepted'
      `).all(req.user.id);

            res.json(friends.map(f => ({
                ...f,
                friend_user_id: f.friend_id
            })));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get pending friend requests
    router.get('/requests', authMiddleware, (req, res) => {
        try {
            const requests = db.prepare(`
        SELECT f.*, u.username, u.avatar
        FROM friends f
        JOIN users u ON f.user_id = u.id
        WHERE f.friend_id = ? AND f.status = 'pending'
      `).all(req.user.id);
            res.json(requests);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Send friend request
    router.post('/request', authMiddleware, (req, res) => {
        try {
            const { userId } = req.body;
            if (userId === req.user.id) {
                return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même' });
            }

            // Check if already friends or request exists
            const existing = db.prepare(`
        SELECT * FROM friends 
        WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
      `).get(req.user.id, userId, userId, req.user.id);

            if (existing) {
                return res.status(400).json({ error: 'Demande déjà envoyée ou déjà amis' });
            }

            // Check if blocked
            const blocked = db.prepare(`
        SELECT * FROM user_blocks WHERE user_id = ? AND blocked_user_id = ?
      `).get(userId, req.user.id);

            if (blocked) {
                return res.status(400).json({ error: 'Impossible d\'envoyer une demande' });
            }

            const id = require('crypto').randomUUID();
            db.prepare(`INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'pending')`)
                .run(id, req.user.id, userId);

            // Emit socket notification to recipient
            const recipientSocket = userSockets.get(userId);
            if (recipientSocket) {
                recipientSocket.emit('friend_request', {
                    id,
                    from_user_id: req.user.id,
                    username: req.user.username,
                    avatar: req.user.avatar
                });
            }

            res.json({ success: true, id });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Accept friend request
    router.post('/accept', authMiddleware, (req, res) => {
        try {
            const { requestId } = req.body;
            const request = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ?')
                .get(requestId, req.user.id);

            if (!request) {
                return res.status(404).json({ error: 'Demande non trouvée' });
            }

            db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', requestId);

            // Create reverse friendship
            const reverseId = require('crypto').randomUUID();
            db.prepare(`INSERT OR IGNORE INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'accepted')`)
                .run(reverseId, req.user.id, request.user_id);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Reject friend request
    router.post('/reject', authMiddleware, (req, res) => {
        try {
            const { requestId } = req.body;
            db.prepare('DELETE FROM friends WHERE id = ? AND friend_id = ?').run(requestId, req.user.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Remove friend
    router.delete('/:friendId', authMiddleware, (req, res) => {
        try {
            const { friendId } = req.params;
            db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
                .run(req.user.id, friendId, friendId, req.user.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Generate friendship link
    router.post('/link', authMiddleware, (req, res) => {
        try {
            const code = Math.random().toString().slice(2, 10);
            const id = require('crypto').randomUUID();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            db.prepare(`INSERT INTO friendship_links (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)`)
                .run(id, req.user.id, code, expiresAt);

            res.json({ code });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Use friendship link
    router.post('/link/:code', authMiddleware, (req, res) => {
        try {
            const { code } = req.params;
            const link = db.prepare(`
        SELECT * FROM friendship_links 
        WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).get(code);

            if (!link) {
                return res.status(404).json({ error: 'Lien invalide ou expiré' });
            }

            if (link.user_id === req.user.id) {
                return res.status(400).json({ error: 'Tu ne peux pas utiliser ton propre lien' });
            }

            // Create friendship (both directions)
            const id1 = require('crypto').randomUUID();
            const id2 = require('crypto').randomUUID();

            db.prepare(`INSERT OR IGNORE INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'accepted')`)
                .run(id1, req.user.id, link.user_id);
            db.prepare(`INSERT OR IGNORE INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'accepted')`)
                .run(id2, link.user_id, req.user.id);

            // Update link uses
            db.prepare('UPDATE friendship_links SET uses = uses + 1 WHERE id = ?').run(link.id);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
