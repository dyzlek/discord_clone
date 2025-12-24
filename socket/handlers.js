// Socket.IO handlers for real-time communication
module.exports = (io, db, userSockets) => {
    // Import voice handlers
    const voiceHandlers = require('./voice')(io, db, userSockets);

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Authenticate socket
        socket.on('authenticate', (token) => {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, 'discord-clone-secret-key-2024');
                const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);

                if (user) {
                    socket.userId = user.id;
                    socket.username = user.username;
                    userSockets.set(user.id, socket);

                    // Update user status
                    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', user.id);

                    // Join user's server rooms for real-time updates
                    const servers = db.prepare(`
                        SELECT server_id FROM server_members WHERE user_id = ?
                    `).all(user.id);
                    servers.forEach(s => {
                        socket.join(`server:${s.server_id}`);
                    });

                    // Broadcast status to friends
                    broadcastUserStatus(user.id, 'online', user.presence);
                    console.log('User authenticated:', user.username);
                }
            } catch (error) {
                console.error('Auth error:', error.message);
            }
        });

        // Typing indicator
        socket.on('typing', ({ conversationId, isTyping }) => {
            if (!socket.userId) return;

            const participants = db.prepare(
                'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?'
            ).all(conversationId, socket.userId);

            participants.forEach(p => {
                const pSocket = userSockets.get(p.user_id);
                if (pSocket) {
                    pSocket.emit('user_typing', {
                        conversationId,
                        userId: socket.userId,
                        isTyping
                    });
                }
            });
        });

        // Server channel typing indicator
        socket.on('channel_typing', ({ channelId, isTyping }) => {
            if (!socket.userId) return;

            const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
            if (!channel) return;

            socket.to(`server:${channel.server_id}`).emit('channel_user_typing', {
                channelId,
                userId: socket.userId,
                username: socket.username,
                isTyping
            });
        });

        // Presence change
        socket.on('presence_change', ({ presence }) => {
            if (!socket.userId) return;

            db.prepare('UPDATE users SET presence = ? WHERE id = ?').run(presence, socket.userId);
            broadcastUserStatus(socket.userId, 'online', presence);
        });

        // =============== VOICE CHANNEL EVENTS ===============

        // Join voice channel
        socket.on('voice:join', ({ channelId }) => {
            if (!socket.userId) return;
            voiceHandlers.joinVoiceChannel(socket, socket.userId, channelId);
        });

        // Leave voice channel
        socket.on('voice:leave', ({ channelId }) => {
            if (!socket.userId) return;
            voiceHandlers.leaveVoiceChannel(socket, socket.userId, channelId);
        });

        // Update voice state (mute, deafen, video, screen share)
        socket.on('voice:state', ({ channelId, state }) => {
            if (!socket.userId) return;
            voiceHandlers.updateVoiceState(socket, socket.userId, channelId, state);
        });

        // WebRTC signaling for voice channels
        socket.on('voice:offer', ({ targetUserId, channelId, offer }) => {
            if (!socket.userId) return;
            voiceHandlers.sendOffer(socket, socket.userId, targetUserId, channelId, offer);
        });

        socket.on('voice:answer', ({ targetUserId, channelId, answer }) => {
            if (!socket.userId) return;
            voiceHandlers.sendAnswer(socket, socket.userId, targetUserId, channelId, answer);
        });

        socket.on('voice:ice_candidate', ({ targetUserId, channelId, candidate }) => {
            if (!socket.userId) return;
            voiceHandlers.sendIceCandidate(socket, socket.userId, targetUserId, channelId, candidate);
        });

        // =============== DM CALL SIGNALING (existing) ===============

        // Call request
        socket.on('call_request', ({ targetUserId, callerUsername, callType }) => {
            console.log(`Call request from ${callerUsername} to ${targetUserId}, type: ${callType}`);

            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('incoming_call', {
                    callerId: socket.userId,
                    callerUsername,
                    callType
                });
            } else {
                socket.emit('call_failed', { reason: 'user_offline' });
            }
        });

        // Call accepted
        socket.on('call_accept', ({ callerId }) => {
            console.log(`Call accepted by ${socket.userId}`);

            const callerSocket = userSockets.get(callerId);
            if (callerSocket) {
                callerSocket.emit('call_accepted', {
                    recipientId: socket.userId
                });
            }
        });

        // Call rejected
        socket.on('call_reject', ({ callerId }) => {
            console.log(`Call rejected by ${socket.userId}`);

            const callerSocket = userSockets.get(callerId);
            if (callerSocket) {
                callerSocket.emit('call_rejected');
            }
        });

        // WebRTC offer (DM calls)
        socket.on('call_offer', ({ targetUserId, offer }) => {
            console.log(`Sending offer to ${targetUserId}`);

            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('call_offer', {
                    callerId: socket.userId,
                    offer
                });
            }
        });

        // WebRTC answer (DM calls)
        socket.on('call_answer', ({ callerId, answer }) => {
            console.log(`Sending answer to ${callerId}`);

            const callerSocket = userSockets.get(callerId);
            if (callerSocket) {
                callerSocket.emit('call_answer', { answer });
            }
        });

        // ICE candidate (DM calls)
        socket.on('ice_candidate', ({ targetUserId, candidate }) => {
            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('ice_candidate', { candidate });
            }
        });

        // End call
        socket.on('call_end', ({ targetUserId }) => {
            console.log(`Call ended by ${socket.userId}`);

            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('call_ended');
            }
        });

        // Screen share state
        socket.on('screen_share_start', ({ targetUserId }) => {
            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('screen_share_started', { userId: socket.userId });
            }
        });

        socket.on('screen_share_stop', ({ targetUserId }) => {
            const targetSocket = userSockets.get(targetUserId);
            if (targetSocket) {
                targetSocket.emit('screen_share_stopped', { userId: socket.userId });
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            if (socket.userId) {
                // Leave all voice channels
                voiceHandlers.leaveAllVoiceChannels(socket, socket.userId);

                userSockets.delete(socket.userId);
                db.prepare("UPDATE users SET status = ?, last_seen = datetime('now') WHERE id = ?")
                    .run('offline', socket.userId);
                broadcastUserStatus(socket.userId, 'offline', 'offline');
            }
            console.log('User disconnected:', socket.id);
        });

        // Helper to broadcast user status
        function broadcastUserStatus(userId, status, presence) {
            // Get user's friends
            const friends = db.prepare(`
                SELECT friend_id FROM friends WHERE user_id = ? AND status = 'accepted'
                UNION
                SELECT user_id as friend_id FROM friends WHERE friend_id = ? AND status = 'accepted'
            `).all(userId, userId);

            friends.forEach(f => {
                const fSocket = userSockets.get(f.friend_id);
                if (fSocket) {
                    fSocket.emit('user_status', { userId, status, presence });
                }
            });

            // Also broadcast to server members
            const servers = db.prepare(`
                SELECT DISTINCT sm2.user_id 
                FROM server_members sm1
                JOIN server_members sm2 ON sm1.server_id = sm2.server_id
                WHERE sm1.user_id = ? AND sm2.user_id != ?
            `).all(userId, userId);

            servers.forEach(m => {
                const mSocket = userSockets.get(m.user_id);
                if (mSocket) {
                    mSocket.emit('user_status', { userId, status, presence });
                }
            });
        }
    });
};
