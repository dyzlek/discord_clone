// public/js/modules/voice.js - Voice/Video WebRTC module
const VoiceModule = (function () {
    let socket = null;
    let currentChannel = null;
    let localStream = null;
    let screenStream = null;
    let peerConnections = new Map(); // userId -> RTCPeerConnection
    let participants = new Map(); // userId -> { stream, audio, video, etc }

    // WebRTC configuration
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // Voice state
    let voiceState = {
        isMuted: false,
        isDeafened: false,
        isVideoOn: false,
        isScreenSharing: false
    };

    // Initialize with socket
    function init(socketInstance) {
        socket = socketInstance;
        setupSocketListeners();
    }

    // Setup socket event listeners
    function setupSocketListeners() {
        if (!socket) return;

        socket.on('voice:joined', handleJoinedChannel);
        socket.on('voice:user_joined', handleUserJoined);
        socket.on('voice:user_left', handleUserLeft);
        socket.on('voice:state_update', handleStateUpdate);
        socket.on('voice:offer', handleOffer);
        socket.on('voice:answer', handleAnswer);
        socket.on('voice:ice_candidate', handleIceCandidate);
        socket.on('voice:error', handleError);
        socket.on('voice:channel_update', handleChannelUpdate);
    }

    // Join voice channel
    async function joinChannel(channelId, withVideo = false) {
        try {
            // Get local media
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: withVideo ? {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                } : false
            };

            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            voiceState.isVideoOn = withVideo;

            // Emit join event
            socket.emit('voice:join', { channelId });
            currentChannel = channelId;

            // Show voice UI
            showVoiceUI();
            updateLocalVideo();

            showToast('Connecté au salon vocal', 'success');
        } catch (error) {
            console.error('Failed to join voice channel:', error);
            showToast('Impossible d\'accéder au microphone/caméra', 'error');
        }
    }

    // Leave voice channel
    function leaveChannel() {
        if (!currentChannel) return;

        socket.emit('voice:leave', { channelId: currentChannel });

        // Stop local streams
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }

        // Close all peer connections
        peerConnections.forEach(pc => pc.close());
        peerConnections.clear();
        participants.clear();

        currentChannel = null;
        hideVoiceUI();

        showToast('Déconnecté du salon vocal', 'info');
    }

    // Handle joined channel response
    async function handleJoinedChannel(data) {
        currentChannel = data.channelId;

        // Create peer connections for existing participants
        for (const participant of data.participants) {
            await createPeerConnection(participant.userId, true);
        }
    }

    // Handle new user joining
    async function handleUserJoined(data) {
        if (data.channelId !== currentChannel) return;

        participants.set(data.user.userId, {
            ...data.user,
            stream: null
        });

        // Wait for them to send offer
        updateParticipantsUI();
    }

    // Handle user leaving
    function handleUserLeft(data) {
        if (data.channelId !== currentChannel) return;

        const pc = peerConnections.get(data.userId);
        if (pc) {
            pc.close();
            peerConnections.delete(data.userId);
        }

        participants.delete(data.userId);
        updateParticipantsUI();
    }

    // Handle voice state updates
    function handleStateUpdate(data) {
        if (data.channelId !== currentChannel) return;

        const participant = participants.get(data.userId);
        if (participant) {
            Object.assign(participant, data);
            updateParticipantsUI();
        }
    }

    // Create peer connection
    async function createPeerConnection(userId, isInitiator) {
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections.set(userId, pc);

        // Add local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle incoming tracks
        pc.ontrack = (event) => {
            const participant = participants.get(userId) || {};
            participant.stream = event.streams[0];
            participants.set(userId, participant);
            updateParticipantsUI();
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('voice:ice_candidate', {
                    targetUserId: userId,
                    channelId: currentChannel,
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state
        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${userId}:`, pc.connectionState);
            if (pc.connectionState === 'failed') {
                // Try to reconnect
                pc.restartIce();
            }
        };

        // If initiator, create and send offer
        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('voice:offer', {
                targetUserId: userId,
                channelId: currentChannel,
                offer
            });
        }

        return pc;
    }

    // Handle incoming offer
    async function handleOffer(data) {
        let pc = peerConnections.get(data.fromUserId);
        if (!pc) {
            pc = await createPeerConnection(data.fromUserId, false);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('voice:answer', {
            targetUserId: data.fromUserId,
            channelId: currentChannel,
            answer
        });
    }

    // Handle incoming answer
    async function handleAnswer(data) {
        const pc = peerConnections.get(data.fromUserId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    }

    // Handle incoming ICE candidate
    async function handleIceCandidate(data) {
        const pc = peerConnections.get(data.fromUserId);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }

    // Handle errors
    function handleError(data) {
        console.error('Voice error:', data.message);
        showToast(data.message, 'error');
    }

    // Handle channel update (participant count changes)
    function handleChannelUpdate(data) {
        const el = document.querySelector(`[data-channel-id="${data.channelId}"] .voice-count`);
        if (el) {
            el.textContent = data.participant_count;
            el.style.display = data.participant_count > 0 ? 'inline' : 'none';
        }
    }

    // Toggle mute
    function toggleMute() {
        if (!localStream) return;

        voiceState.isMuted = !voiceState.isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !voiceState.isMuted;
        });

        socket.emit('voice:state', {
            channelId: currentChannel,
            state: { isMuted: voiceState.isMuted }
        });

        updateControlsUI();
    }

    // Toggle deafen
    function toggleDeafen() {
        voiceState.isDeafened = !voiceState.isDeafened;

        // Mute all incoming audio
        participants.forEach(p => {
            if (p.stream) {
                p.stream.getAudioTracks().forEach(track => {
                    track.enabled = !voiceState.isDeafened;
                });
            }
        });

        // Also mute self when deafened
        if (voiceState.isDeafened && !voiceState.isMuted) {
            toggleMute();
        }

        socket.emit('voice:state', {
            channelId: currentChannel,
            state: { isDeafened: voiceState.isDeafened }
        });

        updateControlsUI();
    }

    // Toggle video
    async function toggleVideo() {
        if (!localStream) return;

        voiceState.isVideoOn = !voiceState.isVideoOn;

        if (voiceState.isVideoOn) {
            // Add video track
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
                });
                const videoTrack = videoStream.getVideoTracks()[0];
                localStream.addTrack(videoTrack);

                // Update all peer connections
                peerConnections.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        pc.addTrack(videoTrack, localStream);
                    }
                });
            } catch (error) {
                console.error('Failed to enable video:', error);
                voiceState.isVideoOn = false;
            }
        } else {
            // Remove video track
            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
        }

        socket.emit('voice:state', {
            channelId: currentChannel,
            state: { isVideoOn: voiceState.isVideoOn }
        });

        updateLocalVideo();
        updateControlsUI();
    }

    // Start screen share
    async function startScreenShare() {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: true
            });

            voiceState.isScreenSharing = true;

            // Replace video track with screen share
            const screenTrack = screenStream.getVideoTracks()[0];

            peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                } else {
                    pc.addTrack(screenTrack, screenStream);
                }
            });

            // Handle screen share stop
            screenTrack.onended = () => {
                stopScreenShare();
            };

            socket.emit('voice:state', {
                channelId: currentChannel,
                state: { isScreenSharing: true }
            });

            updateControlsUI();
            showToast('Partage d\'écran activé', 'success');
        } catch (error) {
            console.error('Failed to start screen share:', error);
            showToast('Partage d\'écran annulé', 'info');
        }
    }

    // Stop screen share
    function stopScreenShare() {
        if (!screenStream) return;

        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        voiceState.isScreenSharing = false;

        // Restore camera if was on
        if (voiceState.isVideoOn && localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                peerConnections.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }
                });
            }
        }

        socket.emit('voice:state', {
            channelId: currentChannel,
            state: { isScreenSharing: false }
        });

        updateControlsUI();
    }

    // UI Functions
    function showVoiceUI() {
        const voiceUI = document.getElementById('voice-channel-ui');
        if (voiceUI) voiceUI.classList.remove('hidden');
        updateControlsUI();
    }

    function hideVoiceUI() {
        const voiceUI = document.getElementById('voice-channel-ui');
        if (voiceUI) voiceUI.classList.add('hidden');
    }

    function updateLocalVideo() {
        const localVideo = document.getElementById('local-video');
        if (localVideo && localStream) {
            localVideo.srcObject = localStream;
        }
    }

    function updateParticipantsUI() {
        const container = document.getElementById('voice-participants-grid');
        if (!container) return;

        container.innerHTML = '';

        participants.forEach((participant, odiumId) => {
            const div = document.createElement('div');
            div.className = 'voice-participant';
            div.dataset.userId = odiumId;

            if (participant.stream && participant.stream.getVideoTracks().length > 0) {
                const video = document.createElement('video');
                video.srcObject = participant.stream;
                video.autoplay = true;
                video.playsInline = true;
                div.appendChild(video);
            } else {
                div.innerHTML = `
                    <div class="participant-avatar">
                        <img src="${participant.avatar || '/default-avatar.png'}" alt="">
                    </div>
                `;
            }

            div.innerHTML += `
                <div class="participant-info">
                    <span class="participant-name">${participant.username}</span>
                    <div class="participant-status">
                        ${participant.isMuted ? '<i class="fas fa-microphone-slash"></i>' : ''}
                        ${participant.isDeafened ? '<i class="fas fa-volume-mute"></i>' : ''}
                        ${participant.isScreenSharing ? '<i class="fas fa-desktop"></i>' : ''}
                    </div>
                </div>
            `;

            container.appendChild(div);

            // If there's audio, create audio element
            if (participant.stream && !voiceState.isDeafened) {
                const audio = document.createElement('audio');
                audio.srcObject = participant.stream;
                audio.autoplay = true;
                audio.id = `audio-${odiumId}`;
                document.body.appendChild(audio);
            }
        });
    }

    function updateControlsUI() {
        const muteBtn = document.getElementById('voice-mute-btn');
        const deafenBtn = document.getElementById('voice-deafen-btn');
        const videoBtn = document.getElementById('voice-video-btn');
        const screenBtn = document.getElementById('voice-screen-btn');

        if (muteBtn) {
            muteBtn.innerHTML = `<i class="fas fa-microphone${voiceState.isMuted ? '-slash' : ''}"></i>`;
            muteBtn.classList.toggle('active', voiceState.isMuted);
        }
        if (deafenBtn) {
            deafenBtn.innerHTML = `<i class="fas fa-${voiceState.isDeafened ? 'volume-mute' : 'headphones'}"></i>`;
            deafenBtn.classList.toggle('active', voiceState.isDeafened);
        }
        if (videoBtn) {
            videoBtn.innerHTML = `<i class="fas fa-video${voiceState.isVideoOn ? '' : '-slash'}"></i>`;
            videoBtn.classList.toggle('active', voiceState.isVideoOn);
        }
        if (screenBtn) {
            screenBtn.innerHTML = `<i class="fas fa-desktop"></i>`;
            screenBtn.classList.toggle('active', voiceState.isScreenSharing);
        }
    }

    // Show join voice prompt
    function showJoinVoicePrompt(channel) {
        const modal = document.getElementById('join-voice-modal');
        if (modal) {
            modal.dataset.channelId = channel.id;
            modal.dataset.channelType = channel.type;
            document.getElementById('join-voice-channel-name').textContent = channel.name;
            modal.classList.remove('hidden');
        }
    }

    // Toast helper
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Public API
    return {
        init,
        joinChannel,
        leaveChannel,
        toggleMute,
        toggleDeafen,
        toggleVideo,
        startScreenShare,
        stopScreenShare,
        showJoinVoicePrompt,
        isInChannel: () => !!currentChannel,
        getCurrentChannel: () => currentChannel,
        getVoiceState: () => ({ ...voiceState })
    };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VoiceModule;
}
