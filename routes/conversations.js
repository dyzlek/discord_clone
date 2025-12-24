const express = require('express');
const router = express.Router();
const crypto = require('crypto');

module.exports = (db, authMiddleware, io, userSockets) => {
    // Get all conversations
    router.get('/', authMiddleware, (req, res) => {
        try {
            const conversations = db.prepare(`
        SELECT c.*, 
          (SELECT json_group_array(json_object(
            'id', u.id, 'username', u.username, 'avatar', u.avatar, 'status', u.status, 'presence', u.presence
          )) FROM conversation_participants cp2 
          JOIN users u ON cp2.user_id = u.id 
          WHERE cp2.conversation_id = c.id) as participants,
          (SELECT json_object(
            'id', m.id, 'content', m.content, 'type', m.type, 'created_at', m.created_at, 'sender_username',
            (SELECT username FROM users WHERE id = m.sender_id)
          ) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL) as unread_count
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        WHERE cp.user_id = ?
        ORDER BY c.updated_at DESC
      `).all(req.user.id, req.user.id);

            const result = conversations.map(c => {
                const participants = JSON.parse(c.participants || '[]');
                const otherUser = participants.find(p => p.id !== req.user.id);
                return {
                    ...c,
                    participants,
                    other_user: otherUser,
                    last_message: c.last_message ? JSON.parse(c.last_message) : null
                };
            });

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Create conversation (DM or Group)
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { userId, userIds, type = 'dm', name } = req.body;
            const convId = crypto.randomUUID();

            if (type === 'group') {
                // Create group DM
                if (!userIds || userIds.length === 0) {
                    return res.status(400).json({ error: 'Ajoutez au moins un membre' });
                }
                if (userIds.length > 9) {
                    return res.status(400).json({ error: 'Maximum 10 personnes dans un groupe' });
                }

                db.prepare(`INSERT INTO conversations (id, type, name, owner_id) VALUES (?, 'group', ?, ?)`)
                    .run(convId, name || 'Nouveau groupe', req.user.id);

                // Add creator
                db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
                    .run(convId, req.user.id);

                // Add members
                for (const uid of userIds) {
                    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
                        .run(convId, uid);
                }

                return res.json({ id: convId, type: 'group', name });
            }

            // DM - check if exists
            const existing = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
        WHERE c.type = 'dm'
      `).get(req.user.id, userId);

            if (existing) {
                return res.json({ id: existing.id });
            }

            // Check if blocked
            const blocked = db.prepare(`
        SELECT * FROM user_blocks WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)
      `).get(req.user.id, userId, userId, req.user.id);

            if (blocked) {
                return res.status(400).json({ error: 'Impossible de créer la conversation' });
            }

            db.prepare('INSERT INTO conversations (id, type) VALUES (?, ?)').run(convId, 'dm');
            db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, req.user.id);
            db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);

            res.json({ id: convId, type: 'dm' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Update group (name, icon)
    router.put('/:id', authMiddleware, (req, res) => {
        try {
            const { name, icon } = req.body;
            const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);

            if (!conv || conv.type !== 'group') {
                return res.status(404).json({ error: 'Groupe non trouvé' });
            }

            if (conv.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Seul le propriétaire peut modifier le groupe' });
            }

            if (name) db.prepare('UPDATE conversations SET name = ? WHERE id = ?').run(name, req.params.id);
            if (icon) db.prepare('UPDATE conversations SET icon = ? WHERE id = ?').run(icon, req.params.id);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Add participant to group
    router.post('/:id/participants', authMiddleware, (req, res) => {
        try {
            const { userId } = req.body;
            const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);

            if (!conv || conv.type !== 'group') {
                return res.status(404).json({ error: 'Groupe non trouvé' });
            }

            // Check participant count
            const count = db.prepare('SELECT COUNT(*) as cnt FROM conversation_participants WHERE conversation_id = ?')
                .get(req.params.id).cnt;

            if (count >= 10) {
                return res.status(400).json({ error: 'Maximum 10 personnes' });
            }

            db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
                .run(req.params.id, userId);

            // Notify group members
            const participants = db.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ?')
                .all(req.params.id);

            participants.forEach(p => {
                const socketId = userSockets.get(p.user_id);
                if (socketId) {
                    io.to(socketId).emit('group_updated', { conversationId: req.params.id });
                }
            });

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Remove participant / Leave group
    router.delete('/:id/participants/:userId', authMiddleware, (req, res) => {
        try {
            const { id, userId } = req.params;
            const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

            if (!conv || conv.type !== 'group') {
                return res.status(404).json({ error: 'Groupe non trouvé' });
            }

            // Only owner can remove others, or user can remove themselves
            if (userId !== req.user.id && conv.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Permission refusée' });
            }

            db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
                .run(id, userId);

            // If owner leaves, transfer ownership or delete group
            if (userId === conv.owner_id) {
                const newOwner = db.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ? LIMIT 1')
                    .get(id);

                if (newOwner) {
                    db.prepare('UPDATE conversations SET owner_id = ? WHERE id = ?').run(newOwner.user_id, id);
                } else {
                    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
                }
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get conversation messages
    router.get('/:id/messages', authMiddleware, (req, res) => {
        try {
            const messages = db.prepare(`
        SELECT m.*, u.username as sender_username, u.avatar as sender_avatar,
          (SELECT json_object('id', rm.id, 'content', rm.content, 'type', rm.type, 
            'username', (SELECT username FROM users WHERE id = rm.sender_id))
          FROM messages rm WHERE rm.id = m.reply_to_id) as reply
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
      `).all(req.params.id);

            res.json(messages.map(m => ({
                ...m,
                reply: m.reply ? JSON.parse(m.reply) : null
            })));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
