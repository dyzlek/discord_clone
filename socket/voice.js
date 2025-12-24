// socket/voice.js - WebRTC Voice & Video Signaling
module.exports = function (io, db, userSockets) {

    // Voice channel participants: Map<channelId, Set<{userId, socketId, ...state}>>
    const voiceChannels = new Map();

    // Get voice state for a user
    function getVoiceState(channelId, userId) {
        const channel = voiceChannels.get(channelId);
        if (!channel) return null;
        return [...channel].find(p => p.userId === userId);
    }

    // Broadcast to all participants in a voice channel
    function broadcastToChannel(channelId, event, data, excludeUserId = null) {
        const channel = voiceChannels.get(channelId);
        if (!channel) return;

        channel.forEach(participant => {
            if (participant.userId !== excludeUserId) {
                const socket = io.sockets.sockets.get(participant.socketId);
                if (socket) {
                    socket.emit(event, data);
                }
            }
        });
    }

    // Get channel from database
    function getChannel(channelId) {
        return db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    }

    // Check if user is member of server
    function isMember(serverId, userId) {
        return db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    }

    return {
        // Join a voice channel
        joinVoiceChannel(socket, userId, channelId) {
            const channel = getChannel(channelId);
            if (!channel) {
                socket.emit('voice:error', { message: 'Salon non trouvé' });
                return;
            }

            if (channel.type !== 'voice' && channel.type !== 'video') {
                socket.emit('voice:error', { message: 'Ce n\'est pas un salon vocal' });
                return;
            }

            if (!isMember(channel.server_id, userId)) {
                socket.emit('voice:error', { message: 'Accès refusé' });
                return;
            }

            // Leave any previous voice channel
            this.leaveAllVoiceChannels(socket, userId);

            // Create channel set if doesn't exist
            if (!voiceChannels.has(channelId)) {
                voiceChannels.set(channelId, new Set());
            }

            const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(userId);

            const participant = {
                odiumId: userId,
                socketId: socket.id,
                username: user.username,
                avatar: user.avatar,
                isMuted: false,
                isDeafened: false,
                isVideoOn: false,
                isScreenSharing: false,
                joinedAt: new Date().toISOString()
            };

            // Save to database
            db.prepare(`
                INSERT OR REPLACE INTO voice_states 
                (user_id, channel_id, server_id, is_muted, is_deafened, is_video_on, is_screen_sharing)
                VALUES (?, ?, ?, 0, 0, 0, 0)
            `).run(userId, channelId, channel.server_id);

            voiceChannels.get(channelId).add(participant);
            socket.join(`voice:${channelId}`);

            // Get existing participants (for WebRTC connections)
            const existingParticipants = [...voiceChannels.get(channelId)]
                .filter(p => p.userId !== userId)
                .map(p => ({
                    odiumId: p.userId,
                    username: p.username,
                    avatar: p.avatar,
                    isMuted: p.isMuted,
                    isDeafened: p.isDeafened,
                    isVideoOn: p.isVideoOn,
                    isScreenSharing: p.isScreenSharing
                }));

            // Send current participants to the joining user
            socket.emit('voice:joined', {
                channelId,
                serverId: channel.server_id,
                participants: existingParticipants
            });

            // Notify existing participants about new user
            broadcastToChannel(channelId, 'voice:user_joined', {
                channelId,
                user: {
                    odiumId: userId,
                    username: user.username,
                    avatar: user.avatar,
                    isMuted: false,
                    isDeafened: false,
                    isVideoOn: false,
                    isScreenSharing: false
                }
            }, userId);

            // Notify all server members about voice state change
            const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(channel.server_id);
            members.forEach(m => {
                const memberSocket = userSockets.get(m.user_id);
                if (memberSocket && m.user_id !== userId) {
                    memberSocket.emit('voice:channel_update', {
                        channelId,
                        participant_count: voiceChannels.get(channelId).size
                    });
                }
            });
        },

        // Leave a voice channel
        leaveVoiceChannel(socket, userId, channelId) {
            const participants = voiceChannels.get(channelId);
            if (!participants) return;

            const participant = [...participants].find(p => p.userId === userId);
            if (!participant) return;

            participants.delete(participant);
            socket.leave(`voice:${channelId}`);

            // Remove from database
            db.prepare('DELETE FROM voice_states WHERE user_id = ? AND channel_id = ?').run(userId, channelId);

            // Clean up empty channel
            if (participants.size === 0) {
                voiceChannels.delete(channelId);
            }

            const channel = getChannel(channelId);

            // Notify remaining participants
            broadcastToChannel(channelId, 'voice:user_left', {
                channelId,
                odiumId: userId
            });

            // Notify server members
            if (channel) {
                const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(channel.server_id);
                members.forEach(m => {
                    const memberSocket = userSockets.get(m.user_id);
                    if (memberSocket) {
                        memberSocket.emit('voice:channel_update', {
                            channelId,
                            participant_count: voiceChannels.get(channelId)?.size || 0
                        });
                    }
                });
            }
        },

        // Leave all voice channels (used on disconnect)
        leaveAllVoiceChannels(socket, userId) {
            voiceChannels.forEach((participants, channelId) => {
                const participant = [...participants].find(p => p.userId === userId);
                if (participant) {
                    this.leaveVoiceChannel(socket, userId, channelId);
                }
            });
        },

        // Update voice state (mute, deafen, video, screen share)
        updateVoiceState(socket, userId, channelId, state) {
            const participants = voiceChannels.get(channelId);
            if (!participants) return;

            const participant = [...participants].find(p => p.userId === userId);
            if (!participant) return;

            // Update state
            Object.assign(participant, state);

            // Update database
            db.prepare(`
                UPDATE voice_states SET 
                    is_muted = ?,
                    is_deafened = ?,
                    is_video_on = ?,
                    is_screen_sharing = ?
                WHERE user_id = ? AND channel_id = ?
            `).run(
                participant.isMuted ? 1 : 0,
                participant.isDeafened ? 1 : 0,
                participant.isVideoOn ? 1 : 0,
                participant.isScreenSharing ? 1 : 0,
                userId,
                channelId
            );

            // Broadcast to channel
            broadcastToChannel(channelId, 'voice:state_update', {
                channelId,
                odiumId: userId,
                ...state
            }, userId);
        },

        // WebRTC Signaling: Send offer
        sendOffer(socket, userId, targetUserId, channelId, offer) {
            // Find target socket
            const channel = voiceChannels.get(channelId);
            if (!channel) return;

            const target = [...channel].find(p => p.userId === targetUserId);
            if (!target) return;

            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('voice:offer', {
                    fromUserId: userId,
                    offer
                });
            }
        },

        // WebRTC Signaling: Send answer
        sendAnswer(socket, userId, targetUserId, channelId, answer) {
            const channel = voiceChannels.get(channelId);
            if (!channel) return;

            const target = [...channel].find(p => p.userId === targetUserId);
            if (!target) return;

            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('voice:answer', {
                    fromUserId: userId,
                    answer
                });
            }
        },

        // WebRTC Signaling: Send ICE candidate
        sendIceCandidate(socket, userId, targetUserId, channelId, candidate) {
            const channel = voiceChannels.get(channelId);
            if (!channel) return;

            const target = [...channel].find(p => p.userId === targetUserId);
            if (!target) return;

            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('voice:ice_candidate', {
                    fromUserId: userId,
                    candidate
                });
            }
        },

        // Get voice channel participants
        getParticipants(channelId) {
            const channel = voiceChannels.get(channelId);
            if (!channel) return [];
            return [...channel].map(p => ({
                odiumId: p.userId,
                username: p.username,
                avatar: p.avatar,
                isMuted: p.isMuted,
                isDeafened: p.isDeafened,
                isVideoOn: p.isVideoOn,
                isScreenSharing: p.isScreenSharing
            }));
        }
    };
};
