const express = require('express');
const router = express.Router();
const crypto = require('crypto');

module.exports = (db, authMiddleware, io, userSockets) => {
    // Send message
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { conversationId, content, type = 'text', fileUrl, fileName, fileSize, replyToId, mentions } = req.body;

            // Check if user is participant
            const participant = db.prepare(
                'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
            ).get(conversationId, req.user.id);

            if (!participant) {
                return res.status(403).json({ error: 'Non autorisé' });
            }

            const msgId = crypto.randomUUID();
            db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_id, content, type, file_url, file_name, file_size, reply_to_id, mentions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(msgId, conversationId, req.user.id, content, type, fileUrl || null, fileName || null, fileSize || null, replyToId || null, mentions ? JSON.stringify(mentions) : null);

            // Update conversation timestamp
            db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);

            // Get full message with sender info
            const message = db.prepare(`
        SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
        FROM messages m JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(msgId);

            // Get reply info if exists
            if (message.reply_to_id) {
                const reply = db.prepare(`
          SELECT m.id, m.content, m.type, u.username 
          FROM messages m JOIN users u ON m.sender_id = u.id 
          WHERE m.id = ?
        `).get(message.reply_to_id);
                message.reply = reply;
            }

            // Broadcast to participants
            const participants = db.prepare(
                'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
            ).all(conversationId);

            participants.forEach(p => {
                const socketId = userSockets.get(p.user_id);
                if (socketId) {
                    io.to(socketId).emit('new_message', message);
                }
            });

            res.json(message);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Forward message
    router.post('/forward', authMiddleware, (req, res) => {
        try {
            const { messageId, targetConversationId } = req.body;

            const original = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
            if (!original) {
                return res.status(404).json({ error: 'Message non trouvé' });
            }

            const newId = crypto.randomUUID();
            db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_id, content, type, file_url, file_name, file_size, forwarded_from)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, targetConversationId, req.user.id, original.content, original.type, original.file_url, original.file_name, original.file_size, messageId);

            db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(targetConversationId);

            const message = db.prepare(`
        SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
        FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
      `).get(newId);

            const participants = db.prepare(
                'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
            ).all(targetConversationId);

            participants.forEach(p => {
                const socketId = userSockets.get(p.user_id);
                if (socketId) {
                    io.to(socketId).emit('new_message', message);
                }
            });

            res.json(message);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Search messages
    router.get('/search', authMiddleware, (req, res) => {
        try {
            const { conversationId, q } = req.query;
            if (!q || q.length < 2) {
                return res.json([]);
            }

            const messages = db.prepare(`
        SELECT m.*, u.username as sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ? AND m.content LIKE ?
        ORDER BY m.created_at DESC
        LIMIT 20
      `).all(conversationId, `%${q}%`);

            res.json(messages);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Mark messages as read
    router.post('/:conversationId/read', authMiddleware, (req, res) => {
        try {
            db.prepare(`
        UPDATE messages SET read_at = datetime('now')
        WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL
      `).run(req.params.conversationId, req.user.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
