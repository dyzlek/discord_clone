// routes/servers.js - Server management routes
const express = require('express');
const crypto = require('crypto');

module.exports = function (db, authMiddleware, io, userSockets) {
    const router = express.Router();

    // ==================== GET ALL SERVERS ====================
    router.get('/', authMiddleware, (req, res) => {
        try {
            const servers = db.prepare(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
                FROM servers s
                JOIN server_members sm ON s.id = sm.server_id
                WHERE sm.user_id = ?
                ORDER BY s.created_at DESC
            `).all(req.user.id);

            res.json(servers);
        } catch (error) {
            console.error('Get servers error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== CREATE SERVER ====================
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { name, icon, description } = req.body;

            if (!name || name.trim().length < 2) {
                return res.status(400).json({ error: 'Nom du serveur requis (min 2 caractères)' });
            }

            const serverId = crypto.randomUUID();
            const inviteCode = crypto.randomBytes(4).toString('hex');
            const defaultChannelId = crypto.randomUUID();
            const defaultRoleId = crypto.randomUUID();

            // Create server
            db.prepare(`
                INSERT INTO servers (id, name, icon, description, owner_id, invite_code)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(serverId, name.trim(), icon || null, description || null, req.user.id, inviteCode);

            // Add owner as member
            db.prepare(`
                INSERT INTO server_members (server_id, user_id)
                VALUES (?, ?)
            `).run(serverId, req.user.id);

            // Create default @everyone role
            db.prepare(`
                INSERT INTO roles (id, server_id, name, is_default, position)
                VALUES (?, ?, '@everyone', 1, 0)
            `).run(defaultRoleId, serverId);

            // Create default text channel
            db.prepare(`
                INSERT INTO channels (id, server_id, name, type, position)
                VALUES (?, ?, 'général', 'text', 0)
            `).run(defaultChannelId, serverId);

            // Create default voice channel
            const voiceChannelId = crypto.randomUUID();
            db.prepare(`
                INSERT INTO channels (id, server_id, name, type, position)
                VALUES (?, ?, 'Vocal Général', 'voice', 1)
            `).run(voiceChannelId, serverId);

            const server = db.prepare(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
                FROM servers s WHERE s.id = ?
            `).get(serverId);

            res.status(201).json(server);
        } catch (error) {
            console.error('Create server error:', error);
            res.status(500).json({ error: 'Erreur lors de la création du serveur' });
        }
    });

    // ==================== GET SERVER DETAILS ====================
    router.get('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            // Check if user is member
            const isMember = db.prepare(`
                SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?
            `).get(id, req.user.id);

            if (!isMember) {
                return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce serveur' });
            }

            const server = db.prepare(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
                FROM servers s WHERE s.id = ?
            `).get(id);

            if (!server) {
                return res.status(404).json({ error: 'Serveur non trouvé' });
            }

            // Get channels
            const channels = db.prepare(`
                SELECT * FROM channels WHERE server_id = ? ORDER BY position
            `).all(id);

            // Get categories
            const categories = db.prepare(`
                SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position
            `).all(id);

            // Get roles
            const roles = db.prepare(`
                SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC
            `).all(id);

            // Get members with their roles
            const members = db.prepare(`
                SELECT u.id, u.username, u.avatar, u.status, u.presence, sm.nickname, sm.joined_at,
                       (SELECT GROUP_CONCAT(r.id) FROM member_roles mr 
                        JOIN roles r ON mr.role_id = r.id 
                        WHERE mr.user_id = u.id AND mr.server_id = ?) as role_ids
                FROM server_members sm
                JOIN users u ON sm.user_id = u.id
                WHERE sm.server_id = ?
                ORDER BY u.username
            `).all(id, id);

            res.json({
                ...server,
                channels,
                categories,
                roles,
                members
            });
        } catch (error) {
            console.error('Get server details error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== UPDATE SERVER ====================
    router.put('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { name, icon, banner, description } = req.body;

            const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
            if (!server) {
                return res.status(404).json({ error: 'Serveur non trouvé' });
            }

            if (server.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Seul le propriétaire peut modifier le serveur' });
            }

            db.prepare(`
                UPDATE servers SET 
                    name = COALESCE(?, name),
                    icon = COALESCE(?, icon),
                    banner = COALESCE(?, banner),
                    description = COALESCE(?, description)
                WHERE id = ?
            `).run(name, icon, banner, description, id);

            const updated = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);

            // Notify all members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:updated', updated);
                }
            });

            res.json(updated);
        } catch (error) {
            console.error('Update server error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== DELETE SERVER ====================
    router.delete('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
            if (!server) {
                return res.status(404).json({ error: 'Serveur non trouvé' });
            }

            if (server.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Seul le propriétaire peut supprimer le serveur' });
            }

            // Notify all members before deletion
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(id);

            // Delete in order (foreign key constraints)
            db.prepare('DELETE FROM server_messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?)').run(id);
            db.prepare('DELETE FROM voice_states WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM member_roles WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM roles WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM channels WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM channel_categories WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM server_invites WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM server_members WHERE server_id = ?').run(id);
            db.prepare('DELETE FROM servers WHERE id = ?').run(id);

            // Notify members
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:deleted', { serverId: id });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete server error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== CREATE INVITE ====================
    router.post('/:id/invites', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { maxUses, expiresIn } = req.body; // expiresIn in hours

            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(id, req.user.id);
            if (!isMember) {
                return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce serveur' });
            }

            const inviteId = crypto.randomUUID();
            const code = crypto.randomBytes(4).toString('hex');
            const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 3600000).toISOString() : null;

            db.prepare(`
                INSERT INTO server_invites (id, server_id, creator_id, code, max_uses, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(inviteId, id, req.user.id, code, maxUses || null, expiresAt);

            res.json({ code, expiresAt, maxUses });
        } catch (error) {
            console.error('Create invite error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== JOIN SERVER VIA INVITE ====================
    router.post('/join/:code', authMiddleware, (req, res) => {
        try {
            const { code } = req.params;

            // Try server_invites table first, then servers.invite_code
            let invite = db.prepare(`
                SELECT si.*, s.name as server_name, s.icon as server_icon
                FROM server_invites si
                JOIN servers s ON si.server_id = s.id
                WHERE si.code = ?
            `).get(code);

            let serverId;

            if (invite) {
                // Check if expired
                if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
                    return res.status(400).json({ error: 'Cette invitation a expiré' });
                }
                // Check max uses
                if (invite.max_uses && invite.uses >= invite.max_uses) {
                    return res.status(400).json({ error: 'Cette invitation a atteint sa limite d\'utilisation' });
                }
                serverId = invite.server_id;

                // Increment uses
                db.prepare('UPDATE server_invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
            } else {
                // Try default invite code on server
                const server = db.prepare('SELECT * FROM servers WHERE invite_code = ?').get(code);
                if (!server) {
                    return res.status(404).json({ error: 'Invitation invalide' });
                }
                serverId = server.id;
            }

            // Check if already member
            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
            if (isMember) {
                return res.status(400).json({ error: 'Vous êtes déjà membre de ce serveur' });
            }

            // Add member
            db.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').run(serverId, req.user.id);

            // Get full server data
            const server = db.prepare(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
                FROM servers s WHERE s.id = ?
            `).get(serverId);

            // Notify other members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ? AND user_id != ?').all(serverId, req.user.id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:member_joined', {
                        serverId,
                        user: {
                            id: req.user.id,
                            username: req.user.username,
                            avatar: req.user.avatar
                        }
                    });
                }
            });

            res.json(server);
        } catch (error) {
            console.error('Join server error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== LEAVE SERVER ====================
    router.post('/:id/leave', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
            if (!server) {
                return res.status(404).json({ error: 'Serveur non trouvé' });
            }

            if (server.owner_id === req.user.id) {
                return res.status(400).json({ error: 'Le propriétaire ne peut pas quitter le serveur. Transférez la propriété ou supprimez le serveur.' });
            }

            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(id, req.user.id);
            if (!isMember) {
                return res.status(400).json({ error: 'Vous n\'êtes pas membre de ce serveur' });
            }

            // Remove member roles
            db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(id, req.user.id);
            // Remove voice state
            db.prepare('DELETE FROM voice_states WHERE server_id = ? AND user_id = ?').run(id, req.user.id);
            // Remove from server
            db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(id, req.user.id);

            // Notify other members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:member_left', {
                        serverId: id,
                        userId: req.user.id
                    });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Leave server error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== KICK MEMBER ====================
    router.delete('/:id/members/:userId', authMiddleware, (req, res) => {
        try {
            const { id, userId } = req.params;

            const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
            if (!server) {
                return res.status(404).json({ error: 'Serveur non trouvé' });
            }

            // Only owner can kick for now (can add role permissions later)
            if (server.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            if (userId === server.owner_id) {
                return res.status(400).json({ error: 'Impossible d\'expulser le propriétaire' });
            }

            // Remove member
            db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(id, userId);
            db.prepare('DELETE FROM voice_states WHERE server_id = ? AND user_id = ?').run(id, userId);
            db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(id, userId);

            // Notify kicked user
            const kickedSocket = userSockets.get(userId);
            if (kickedSocket) {
                kickedSocket.emit('server:kicked', { serverId: id });
            }

            // Notify other members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('server:member_left', {
                        serverId: id,
                        userId
                    });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Kick member error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    return router;
};
