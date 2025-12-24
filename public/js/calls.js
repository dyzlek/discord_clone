// WebRTC Calls Module
class CallManager {
    constructor(socket) {
        this.socket = socket;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.callType = null;
        this.callPartner = null;
        this.isInCall = false;
        this.callTimer = null;
        this.callDuration = 0;

        // ICE servers for NAT traversal
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        // Incoming call
        this.socket.on('incoming_call', async (data) => {
            console.log('Incoming call from:', data.callerUsername);
            this.callPartner = { id: data.callerId, username: data.callerUsername };
            this.callType = data.callType;
            this.showIncomingCall(data);
        });

        // Call accepted by recipient
        this.socket.on('call_accepted', async (data) => {
            console.log('Call accepted, sending offer');
            await this.createPeerConnection();
            await this.getLocalMedia();

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this.socket.emit('call_offer', {
                targetUserId: this.callPartner.id,
                offer
            });
        });

        // Received offer
        this.socket.on('call_offer', async (data) => {
            console.log('Received call offer');
            await this.createPeerConnection();
            await this.getLocalMedia();

            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.socket.emit('call_answer', {
                callerId: data.callerId,
                answer
            });

            this.showActiveCall();
        });

        // Received answer
        this.socket.on('call_answer', async (data) => {
            console.log('Received call answer');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            this.showActiveCall();
        });

        // ICE candidate
        this.socket.on('ice_candidate', async (data) => {
            if (this.peerConnection && data.candidate) {
                try {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate:', e);
                }
            }
        });

        // Call rejected
        this.socket.on('call_rejected', () => {
            console.log('Call was rejected');
            this.cleanup();
            showToast('Appel refusé', 'info');
        });

        // Call ended
        this.socket.on('call_ended', () => {
            console.log('Call ended by other party');
            this.cleanup();
        });

        // Call failed
        this.socket.on('call_failed', (data) => {
            console.log('Call failed:', data.reason);
            showToast(data.reason === 'user_offline' ? 'Utilisateur hors ligne' : 'Appel échoué', 'error');
            this.cleanup();
        });
    }

    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.iceServers);

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.callPartner) {
                this.socket.emit('ice_candidate', {
                    targetUserId: this.callPartner.id,
                    candidate: event.candidate
                });
            }
        };

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track');
            this.remoteStream = event.streams[0];
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo) {
                remoteVideo.srcObject = this.remoteStream;
            }
        };

        // Handle connection state
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.isInCall = true;
                this.startCallTimer();
            } else if (this.peerConnection.connectionState === 'disconnected' ||
                this.peerConnection.connectionState === 'failed') {
                this.cleanup();
            }
        };
    }

    async getLocalMedia() {
        try {
            const constraints = {
                audio: true,
                video: this.callType === 'video'
            };

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Add tracks to peer connection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Show local video
            const localVideo = document.getElementById('local-video');
            if (localVideo && this.callType === 'video') {
                localVideo.srcObject = this.localStream;
            }
        } catch (error) {
            console.error('Error getting local media:', error);
            showToast('Impossible d\'accéder au microphone/caméra', 'error');
            this.cleanup();
        }
    }

    initiateCall(partner, type) {
        if (this.isInCall) {
            showToast('Vous êtes déjà en appel', 'error');
            return;
        }

        this.callPartner = partner;
        this.callType = type;

        console.log('Initiating call to:', partner.username, 'type:', type);

        this.socket.emit('call_request', {
            targetUserId: partner.id,
            callerUsername: window.currentUser?.username || 'Utilisateur',
            callType: type
        });

        // Show waiting UI
        this.showWaitingUI();
    }

    acceptCall() {
        console.log('Accepting call');
        this.hideIncomingCall();

        this.socket.emit('call_accept', {
            callerId: this.callPartner.id
        });
    }

    rejectCall() {
        console.log('Rejecting call');
        this.hideIncomingCall();

        this.socket.emit('call_reject', {
            callerId: this.callPartner.id
        });

        this.cleanup();
    }

    endCall() {
        if (this.callPartner) {
            this.socket.emit('call_end', {
                targetUserId: this.callPartner.id
            });
        }
        this.cleanup();
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                return !audioTrack.enabled; // return true if muted
            }
        }
        return false;
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                return !videoTrack.enabled; // return true if disabled
            }
        }
        return false;
    }

    showIncomingCall(data) {
        const modal = document.getElementById('incoming-call-modal');
        const caller = document.getElementById('caller-name');
        const typeEl = document.getElementById('call-type-incoming');

        if (modal && caller) {
            caller.textContent = data.callerUsername;
            if (typeEl) typeEl.textContent = data.callType === 'video' ? 'Appel vidéo' : 'Appel audio';
            modal.classList.remove('hidden');
        }
    }

    hideIncomingCall() {
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.classList.add('hidden');
    }

    showWaitingUI() {
        // Could show a "calling..." indicator
        console.log('Waiting for answer...');
    }

    showActiveCall() {
        const modal = document.getElementById('active-call-modal');
        const username = document.getElementById('active-call-username');

        if (modal) {
            if (username && this.callPartner) {
                username.textContent = this.callPartner.username;
            }
            modal.classList.remove('hidden');

            // Show/hide video based on call type
            const localVideo = document.getElementById('local-video');
            const remoteVideo = document.getElementById('remote-video');
            if (localVideo) localVideo.style.display = this.callType === 'video' ? 'block' : 'none';
            if (remoteVideo) remoteVideo.style.display = this.callType === 'video' ? 'block' : 'none';
        }
    }

    startCallTimer() {
        this.callDuration = 0;
        const timerEl = document.getElementById('call-timer');

        this.callTimer = setInterval(() => {
            this.callDuration++;
            if (timerEl) {
                const mins = Math.floor(this.callDuration / 60);
                const secs = this.callDuration % 60;
                timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    cleanup() {
        console.log('Cleaning up call');

        // Stop timer
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Reset state
        this.remoteStream = null;
        this.callPartner = null;
        this.callType = null;
        this.isInCall = false;
        this.callDuration = 0;

        // Hide modals
        const incomingModal = document.getElementById('incoming-call-modal');
        const activeModal = document.getElementById('active-call-modal');
        if (incomingModal) incomingModal.classList.add('hidden');
        if (activeModal) activeModal.classList.add('hidden');

        // Clear video elements
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        if (localVideo) localVideo.srcObject = null;
        if (remoteVideo) remoteVideo.srcObject = null;
    }
}

// Export for use in app.js
window.CallManager = CallManager;
