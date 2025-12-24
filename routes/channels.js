// routes/channels.js - Channel management routes
const express = require('express');
const crypto = require('crypto');

module.exports = function (db, authMiddleware, io, userSockets) {
    const router = express.Router();

    // Helper: Check if user is server member
    function isMember(serverId, userId) {
        return db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    }

    // Helper: Check if user is server owner
    function isOwner(serverId, userId) {
        return db.prepare('SELECT 1 FROM servers WHERE id = ? AND owner_id = ?').get(serverId, userId);
    }

    // ==================== GET CHANNELS FOR SERVER ====================
    router.get('/server/:serverId', authMiddleware, (req, res) => {
        try {
            const { serverId } = req.params;

            if (!isMember(serverId, req.user.id)) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            const channels = db.prepare(`
                SELECT c.*, 
                       (SELECT COUNT(*) FROM voice_states WHERE channel_id = c.id) as voice_participant_count
                FROM channels c 
                WHERE c.server_id = ? 
                ORDER BY c.position
            `).all(serverId);

            const categories = db.prepare(`
                SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position
            `).all(serverId);

            res.json({ channels, categories });
        } catch (error) {
            console.error('Get channels error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== CREATE CHANNEL ====================
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { serverId, name, type = 'text', categoryId, topic } = req.body;

            if (!serverId || !name) {
                return res.status(400).json({ error: 'serverId et name requis' });
            }

            if (!isOwner(serverId, req.user.id)) {
                return res.status(403).json({ error: 'Seul le propriétaire peut créer des salons' });
            }

            // Get max position
            const maxPos = db.prepare('SELECT MAX(position) as max FROM channels WHERE server_id = ?').get(serverId);
            const position = (maxPos?.max ?? -1) + 1;

            const channelId = crypto.randomUUID();

            db.prepare(`
                INSERT INTO channels (id, server_id, category_id, name, type, topic, position)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(channelId, serverId, categoryId || null, name.toLowerCase().replace(/\s+/g, '-'), type, topic || null, position);

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);

            // Notify all server members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('channel:created', { serverId, channel });
                }
            });

            res.status(201).json(channel);
        } catch (error) {
            console.error('Create channel error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== UPDATE CHANNEL ====================
    router.put('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { name, topic, position } = req.body;

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
            if (!channel) {
                return res.status(404).json({ error: 'Salon non trouvé' });
            }

            if (!isOwner(channel.server_id, req.user.id)) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            db.prepare(`
                UPDATE channels SET 
                    name = COALESCE(?, name),
                    topic = COALESCE(?, topic),
                    position = COALESCE(?, position)
                WHERE id = ?
            `).run(name?.toLowerCase().replace(/\s+/g, '-'), topic, position, id);

            const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(channel.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('channel:updated', { serverId: channel.server_id, channel: updated });
                }
            });

            res.json(updated);
        } catch (error) {
            console.error('Update channel error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== DELETE CHANNEL ====================
    router.delete('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
            if (!channel) {
                return res.status(404).json({ error: 'Salon non trouvé' });
            }

            if (!isOwner(channel.server_id, req.user.id)) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            // Delete messages and voice states first
            db.prepare('DELETE FROM server_messages WHERE channel_id = ?').run(id);
            db.prepare('DELETE FROM voice_states WHERE channel_id = ?').run(id);
            db.prepare('DELETE FROM channels WHERE id = ?').run(id);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(channel.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('channel:deleted', { serverId: channel.server_id, channelId: id });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete channel error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== CREATE CATEGORY ====================
    router.post('/categories', authMiddleware, (req, res) => {
        try {
            const { serverId, name } = req.body;

            if (!serverId || !name) {
                return res.status(400).json({ error: 'serverId et name requis' });
            }

            if (!isOwner(serverId, req.user.id)) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            const maxPos = db.prepare('SELECT MAX(position) as max FROM channel_categories WHERE server_id = ?').get(serverId);
            const position = (maxPos?.max ?? -1) + 1;

            const categoryId = crypto.randomUUID();

            db.prepare(`
                INSERT INTO channel_categories (id, server_id, name, position)
                VALUES (?, ?, ?, ?)
            `).run(categoryId, serverId, name, position);

            const category = db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(categoryId);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('category:created', { serverId, category });
                }
            });

            res.status(201).json(category);
        } catch (error) {
            console.error('Create category error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== DELETE CATEGORY ====================
    router.delete('/categories/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            const category = db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(id);
            if (!category) {
                return res.status(404).json({ error: 'Catégorie non trouvée' });
            }

            if (!isOwner(category.server_id, req.user.id)) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            // Remove category from channels (don't delete the channels)
            db.prepare('UPDATE channels SET category_id = NULL WHERE category_id = ?').run(id);
            db.prepare('DELETE FROM channel_categories WHERE id = ?').run(id);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(category.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('category:deleted', { serverId: category.server_id, categoryId: id });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete category error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== GET CHANNEL MESSAGES ====================
    router.get('/:id/messages', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { limit = 50, before } = req.query;

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
            if (!channel) {
                return res.status(404).json({ error: 'Salon non trouvé' });
            }

            if (!isMember(channel.server_id, req.user.id)) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            let query = `
                SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
                FROM server_messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.channel_id = ?
            `;

            const params = [id];

            if (before) {
                query += ' AND m.created_at < ?';
                params.push(before);
            }

            query += ' ORDER BY m.created_at DESC LIMIT ?';
            params.push(parseInt(limit));

            const messages = db.prepare(query).all(...params);

            res.json(messages.reverse());
        } catch (error) {
            console.error('Get channel messages error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== SEND MESSAGE TO CHANNEL ====================
    router.post('/:id/messages', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { content, type = 'text', fileUrl, fileName, fileSize, replyToId, mentions } = req.body;

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
            if (!channel) {
                return res.status(404).json({ error: 'Salon non trouvé' });
            }

            if (!isMember(channel.server_id, req.user.id)) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            if (!content && !fileUrl) {
                return res.status(400).json({ error: 'Contenu ou fichier requis' });
            }

            const messageId = crypto.randomUUID();

            db.prepare(`
                INSERT INTO server_messages (id, channel_id, sender_id, content, type, file_url, file_name, file_size, reply_to_id, mentions)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(messageId, id, req.user.id, content, type, fileUrl || null, fileName || null, fileSize || null, replyToId || null, mentions ? JSON.stringify(mentions) : null);

            const message = db.prepare(`
                SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
                FROM server_messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.id = ?
            `).get(messageId);

            // Notify all members via socket
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(channel.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:message', {
                        serverId: channel.server_id,
                        channelId: id,
                        message
                    });
                }
            });

            res.status(201).json(message);
        } catch (error) {
            console.error('Send channel message error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    return router;
};
