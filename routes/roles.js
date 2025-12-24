// routes/roles.js - Role and permission management routes
const express = require('express');
const crypto = require('crypto');

// Default permissions structure
const DEFAULT_PERMISSIONS = {
    viewChannels: true,
    sendMessages: true,
    readMessageHistory: true,
    addReactions: true,
    attachFiles: true,
    embedLinks: true,
    mentionEveryone: false,
    manageMessages: false,
    manageChannels: false,
    manageRoles: false,
    manageServer: false,
    kickMembers: false,
    banMembers: false,
    createInvite: true,
    changeNickname: true,
    manageNicknames: false,
    connect: true,
    speak: true,
    video: true,
    muteMembers: false,
    deafenMembers: false,
    moveMembers: false,
    administrator: false
};

module.exports = function (db, authMiddleware, io, userSockets) {
    const router = express.Router();

    // Helper: Check permissions
    function hasPermission(serverId, userId, permission) {
        const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
        if (server?.owner_id === userId) return true; // Owner has all permissions

        const roles = db.prepare(`
            SELECT r.permissions FROM roles r
            JOIN member_roles mr ON r.id = mr.role_id
            WHERE mr.server_id = ? AND mr.user_id = ?
            UNION
            SELECT permissions FROM roles WHERE server_id = ? AND is_default = 1
        `).all(serverId, userId, serverId);

        for (const role of roles) {
            const perms = JSON.parse(role.permissions || '{}');
            if (perms.administrator || perms[permission]) return true;
        }
        return false;
    }

    // ==================== GET ROLES ====================
    router.get('/server/:serverId', authMiddleware, (req, res) => {
        try {
            const { serverId } = req.params;

            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
            if (!isMember) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            const roles = db.prepare(`
                SELECT r.*, 
                       (SELECT COUNT(*) FROM member_roles WHERE role_id = r.id) as member_count
                FROM roles r 
                WHERE r.server_id = ? 
                ORDER BY r.position DESC
            `).all(serverId);

            // Parse permissions
            const parsedRoles = roles.map(r => ({
                ...r,
                permissions: JSON.parse(r.permissions || '{}')
            }));

            res.json(parsedRoles);
        } catch (error) {
            console.error('Get roles error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== CREATE ROLE ====================
    router.post('/', authMiddleware, (req, res) => {
        try {
            const { serverId, name, color, permissions } = req.body;

            if (!serverId || !name) {
                return res.status(400).json({ error: 'serverId et name requis' });
            }

            if (!hasPermission(serverId, req.user.id, 'manageRoles')) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            const maxPos = db.prepare('SELECT MAX(position) as max FROM roles WHERE server_id = ?').get(serverId);
            const position = (maxPos?.max ?? 0) + 1;

            const roleId = crypto.randomUUID();
            const perms = { ...DEFAULT_PERMISSIONS, ...permissions };

            db.prepare(`
                INSERT INTO roles (id, server_id, name, color, position, permissions)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(roleId, serverId, name, color || '#99AAB5', position, JSON.stringify(perms));

            const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
            role.permissions = JSON.parse(role.permissions);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('role:created', { serverId, role });
                }
            });

            res.status(201).json(role);
        } catch (error) {
            console.error('Create role error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== UPDATE ROLE ====================
    router.put('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;
            const { name, color, position, permissions } = req.body;

            const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
            if (!role) {
                return res.status(404).json({ error: 'Rôle non trouvé' });
            }

            if (!hasPermission(role.server_id, req.user.id, 'manageRoles')) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            // Can't edit @everyone name
            if (role.is_default && name && name !== '@everyone') {
                return res.status(400).json({ error: 'Impossible de renommer le rôle @everyone' });
            }

            const existingPerms = JSON.parse(role.permissions || '{}');
            const newPerms = permissions ? { ...existingPerms, ...permissions } : existingPerms;

            db.prepare(`
                UPDATE roles SET 
                    name = COALESCE(?, name),
                    color = COALESCE(?, color),
                    position = COALESCE(?, position),
                    permissions = ?
                WHERE id = ?
            `).run(name, color, position, JSON.stringify(newPerms), id);

            const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
            updated.permissions = JSON.parse(updated.permissions);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(role.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('role:updated', { serverId: role.server_id, role: updated });
                }
            });

            res.json(updated);
        } catch (error) {
            console.error('Update role error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== DELETE ROLE ====================
    router.delete('/:id', authMiddleware, (req, res) => {
        try {
            const { id } = req.params;

            const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
            if (!role) {
                return res.status(404).json({ error: 'Rôle non trouvé' });
            }

            if (role.is_default) {
                return res.status(400).json({ error: 'Impossible de supprimer le rôle @everyone' });
            }

            if (!hasPermission(role.server_id, req.user.id, 'manageRoles')) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            // Remove role from members
            db.prepare('DELETE FROM member_roles WHERE role_id = ?').run(id);
            db.prepare('DELETE FROM roles WHERE id = ?').run(id);

            // Notify members
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(role.server_id);
            members.forEach(m => {
                const socket = userSockets.get(m.user_id);
                if (socket) {
                    socket.emit('role:deleted', { serverId: role.server_id, roleId: id });
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete role error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== ASSIGN ROLE TO MEMBER ====================
    router.post('/assign', authMiddleware, (req, res) => {
        try {
            const { serverId, userId, roleId } = req.body;

            if (!serverId || !userId || !roleId) {
                return res.status(400).json({ error: 'serverId, userId et roleId requis' });
            }

            if (!hasPermission(serverId, req.user.id, 'manageRoles')) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(roleId, serverId);
            if (!role) {
                return res.status(404).json({ error: 'Rôle non trouvé' });
            }

            if (role.is_default) {
                return res.status(400).json({ error: 'Le rôle @everyone est attribué automatiquement' });
            }

            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
            if (!isMember) {
                return res.status(404).json({ error: 'Membre non trouvé' });
            }

            // Check if already has role
            const hasRole = db.prepare('SELECT 1 FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?').get(serverId, userId, roleId);
            if (hasRole) {
                return res.status(400).json({ error: 'Ce membre a déjà ce rôle' });
            }

            db.prepare('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)').run(serverId, userId, roleId);

            // Get updated member roles
            const memberRoles = db.prepare(`
                SELECT r.* FROM roles r
                JOIN member_roles mr ON r.id = mr.role_id
                WHERE mr.server_id = ? AND mr.user_id = ?
            `).all(serverId, userId);

            // Notify the member
            const socket = userSockets.get(userId);
            if (socket) {
                socket.emit('roles:updated', { serverId, roles: memberRoles });
            }

            res.json({ success: true, roles: memberRoles });
        } catch (error) {
            console.error('Assign role error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== REMOVE ROLE FROM MEMBER ====================
    router.delete('/assign/:serverId/:userId/:roleId', authMiddleware, (req, res) => {
        try {
            const { serverId, userId, roleId } = req.params;

            if (!hasPermission(serverId, req.user.id, 'manageRoles')) {
                return res.status(403).json({ error: 'Permissions insuffisantes' });
            }

            db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?').run(serverId, userId, roleId);

            // Get updated member roles
            const memberRoles = db.prepare(`
                SELECT r.* FROM roles r
                JOIN member_roles mr ON r.id = mr.role_id
                WHERE mr.server_id = ? AND mr.user_id = ?
            `).all(serverId, userId);

            // Notify the member
            const socket = userSockets.get(userId);
            if (socket) {
                socket.emit('roles:updated', { serverId, roles: memberRoles });
            }

            res.json({ success: true, roles: memberRoles });
        } catch (error) {
            console.error('Remove role error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    // ==================== GET MEMBER ROLES ====================
    router.get('/member/:serverId/:userId', authMiddleware, (req, res) => {
        try {
            const { serverId, userId } = req.params;

            const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, req.user.id);
            if (!isMember) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            const roles = db.prepare(`
                SELECT r.* FROM roles r
                JOIN member_roles mr ON r.id = mr.role_id
                WHERE mr.server_id = ? AND mr.user_id = ?
                ORDER BY r.position DESC
            `).all(serverId, userId);

            // Also include @everyone role
            const everyoneRole = db.prepare('SELECT * FROM roles WHERE server_id = ? AND is_default = 1').get(serverId);
            if (everyoneRole) {
                roles.push(everyoneRole);
            }

            res.json(roles.map(r => ({
                ...r,
                permissions: JSON.parse(r.permissions || '{}')
            })));
        } catch (error) {
            console.error('Get member roles error:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    return router;
};
