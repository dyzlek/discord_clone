// ==================== STATE ====================
let currentUser = null;
let token = localStorage.getItem('token');
let socket = null;
let currentConversation = null;
let conversations = [];
let friends = [];
let friendRequests = [];
let blockedUsers = [];
let typingTimeout = null;
let pendingFile = null;
let replyingTo = null;
let forwardingMessage = null;
let selectedGroupMembers = [];
let currentFriendsTab = 'all';

// Voice Recording State
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let audioContext = null;
let analyser = null;
let waveformBars = [];

// WebRTC Call State
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallType = null;
let callPartner = null;
let callDurationTimer = null;
let callStartTime = null;
let isMuted = false;
let isVideoOff = false;

// ICE servers for WebRTC
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        validateToken();
    }
    setupEventListeners();
});

function setupEventListeners() {
    // Auth form switching
    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        document.getElementById('auth-title').textContent = 'Créer un compte';
        document.getElementById('auth-subtitle').textContent = 'Rejoins-nous !';
        document.getElementById('auth-error').classList.add('hidden');
    });

    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('auth-title').textContent = 'Bon retour !';
        document.getElementById('auth-subtitle').textContent = 'Nous sommes heureux de te revoir !';
        document.getElementById('auth-error').classList.add('hidden');
    });

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        await login(email, password);
    });

    // Register form
    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        await register(username, email, password);
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logout);

    // User search
    let searchTimeout;
    document.getElementById('user-search')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length >= 2) {
            searchTimeout = setTimeout(() => searchUsers(query), 300);
        } else {
            document.getElementById('search-modal').classList.add('hidden');
        }
    });

    document.getElementById('close-search-modal')?.addEventListener('click', () => {
        document.getElementById('search-modal').classList.add('hidden');
        document.getElementById('user-search').value = '';
    });

    // Message input
    const messageInput = document.getElementById('message-input');
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput?.addEventListener('input', (e) => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        sendTypingIndicator(true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => sendTypingIndicator(false), 2000);

        // Check for mentions
        handleMentionAutocomplete(e.target.value);
    });

    // File upload
    document.getElementById('attach-btn')?.addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input')?.addEventListener('change', handleFileSelect);
    document.getElementById('close-file-modal')?.addEventListener('click', closeFilePreview);
    document.getElementById('cancel-upload')?.addEventListener('click', closeFilePreview);
    document.getElementById('confirm-upload')?.addEventListener('click', uploadFile);

    // Image viewer
    document.getElementById('close-image-viewer')?.addEventListener('click', () => {
        document.getElementById('image-viewer-modal').classList.add('hidden');
    });
    document.getElementById('image-viewer-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'image-viewer-modal') {
            e.target.classList.add('hidden');
        }
    });

    // Close modals on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
        // Ctrl+F for message search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentConversation) {
            e.preventDefault();
            openMessageSearch();
        }
    });

    // Voice Recording
    document.getElementById('voice-btn')?.addEventListener('click', startVoiceRecording);
    document.getElementById('cancel-voice')?.addEventListener('click', cancelVoiceRecording);
    document.getElementById('send-voice')?.addEventListener('click', sendVoiceMessage);

    // Call buttons
    document.getElementById('video-call-btn')?.addEventListener('click', () => initiateCall('video'));
    document.getElementById('audio-call-btn')?.addEventListener('click', () => initiateCall('audio'));
    document.getElementById('reject-call')?.addEventListener('click', rejectIncomingCall);
    document.getElementById('accept-call')?.addEventListener('click', acceptIncomingCall);
    document.getElementById('toggle-mute')?.addEventListener('click', toggleMuteAudio);
    document.getElementById('toggle-video')?.addEventListener('click', toggleVideoStream);
    document.getElementById('end-call')?.addEventListener('click', endCurrentCall);

    // Settings
    document.getElementById('user-settings')?.addEventListener('click', openSettings);
    document.getElementById('close-settings')?.addEventListener('click', closeSettingsModal);
    document.getElementById('cancel-settings')?.addEventListener('click', closeSettingsModal);
    document.getElementById('save-settings')?.addEventListener('click', saveUserSettings);
    document.getElementById('change-avatar-btn')?.addEventListener('click', () => document.getElementById('avatar-input').click());
    document.getElementById('avatar-input')?.addEventListener('change', handleAvatarSelect);
    document.getElementById('change-banner-btn')?.addEventListener('click', () => document.getElementById('banner-input').click());
    document.getElementById('banner-input')?.addEventListener('change', handleBannerSelect);

    // Friends panel
    document.getElementById('nav-friends')?.addEventListener('click', showFriendsPanel);
    document.querySelectorAll('.friends-tab').forEach(tab => {
        tab.addEventListener('click', () => switchFriendsTab(tab.dataset.tab));
    });
    document.getElementById('send-friend-request')?.addEventListener('click', sendFriendRequest);
    document.getElementById('generate-friend-link')?.addEventListener('click', generateFriendLink);
    document.getElementById('copy-friend-link')?.addEventListener('click', copyFriendLink);

    // Group creation
    document.getElementById('create-group-btn')?.addEventListener('click', openCreateGroupModal);
    document.getElementById('close-group-modal')?.addEventListener('click', closeCreateGroupModal);
    document.getElementById('cancel-group')?.addEventListener('click', closeCreateGroupModal);
    document.getElementById('confirm-group')?.addEventListener('click', createGroup);
    document.getElementById('group-members-search')?.addEventListener('input', searchGroupMembers);

    // Message search
    document.getElementById('search-messages-btn')?.addEventListener('click', openMessageSearch);
    document.getElementById('close-message-search')?.addEventListener('click', closeMessageSearch);
    document.getElementById('message-search-input')?.addEventListener('input', debounce(searchMessages, 300));

    // Reply
    document.getElementById('cancel-reply')?.addEventListener('click', cancelReply);

    // Forward modal
    document.getElementById('close-forward-modal')?.addEventListener('click', closeForwardModal);
    document.getElementById('forward-search')?.addEventListener('input', filterForwardConversations);

    // Context menu
    document.addEventListener('click', () => hideContextMenu());
    document.getElementById('ctx-reply')?.addEventListener('click', () => {
        if (window.contextMenuMessageId) startReply(window.contextMenuMessageId);
        hideContextMenu();
    });
    document.getElementById('ctx-forward')?.addEventListener('click', () => {
        if (window.contextMenuMessageId) openForwardModal(window.contextMenuMessageId);
        hideContextMenu();
    });
    document.getElementById('ctx-copy')?.addEventListener('click', () => {
        if (window.contextMenuContent) {
            navigator.clipboard.writeText(window.contextMenuContent);
        }
        hideContextMenu();
    });
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    cancelReply();
    if (document.getElementById('voice-recording-modal') &&
        !document.getElementById('voice-recording-modal').classList.contains('hidden')) {
        cancelVoiceRecording();
    }
}

// ==================== AUTH FUNCTIONS ====================
async function login(email, password) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            showAuthError(data.error || 'Erreur de connexion');
            return;
        }
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        showApp();
    } catch (error) {
        showAuthError('Erreur de connexion au serveur');
    }
}

async function register(username, email, password) {
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            showAuthError(data.error || "Erreur d'inscription");
            return;
        }
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        showApp();
    } catch (error) {
        showAuthError('Erreur de connexion au serveur');
    }
}

async function validateToken() {
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            logout();
            return;
        }
        currentUser = await res.json();
        showApp();
    } catch (error) {
        logout();
    }
}

function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('token');
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('login-form').reset();
    document.getElementById('register-form').reset();
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
}

function showAuthError(message) {
    const authError = document.getElementById('auth-error');
    authError.textContent = message;
    authError.classList.remove('hidden');
}

// ==================== APP FUNCTIONS ====================
function showApp() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('current-username').textContent = currentUser.username;
    updateUserAvatar();
    updateStatusText();
    connectSocket();
    loadConversations();
    loadFriends();
    loadFriendRequests();

    // Load servers
    if (typeof ServersModule !== 'undefined') {
        ServersModule.loadServers();
    }

    // Initialize voice module with socket
    if (typeof VoiceModule !== 'undefined' && socket) {
        VoiceModule.init(socket);
    }
}

function updateUserAvatar() {
    const avatarEl = document.getElementById('current-user-avatar');
    if (currentUser.avatar) {
        avatarEl.innerHTML = `<img src="${currentUser.avatar}" alt=""><span class="status-indicator ${currentUser.presence || 'online'}"></span>`;
    } else {
        avatarEl.innerHTML = `${currentUser.username.charAt(0).toUpperCase()}<span class="status-indicator ${currentUser.presence || 'online'}"></span>`;
    }
}

function updateStatusText() {
    const statusEl = document.getElementById('current-status-text');
    if (currentUser.custom_status) {
        statusEl.textContent = currentUser.custom_status;
    } else {
        const statusMap = { online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', invisible: 'Invisible' };
        statusEl.textContent = statusMap[currentUser.presence] || 'En ligne';
    }
}

function connectSocket() {
    socket = io();

    socket.on('connect', () => {
        socket.emit('authenticate', token);
    });

    socket.on('new_message', (message) => {
        if (currentConversation && message.conversation_id === currentConversation.id) {
            // Skip if this is our own message (already displayed via optimistic UI)
            if (message.sender_id === currentUser.id) {
                // Remove pending message and replace with confirmed one
                const pendingMsg = document.querySelector('.message.pending');
                if (pendingMsg) pendingMsg.remove();
            }
            appendMessage(message);
            scrollToBottom();
            if (message.sender_id !== currentUser.id) {
                markMessagesAsRead(currentConversation.id);
            }
        }
        loadConversations();
    });

    socket.on('user_typing', ({ conversationId, userId, isTyping }) => {
        if (currentConversation && conversationId === currentConversation.id && userId !== currentUser.id) {
            const typingEl = document.getElementById('typing-indicator');
            typingEl.classList.toggle('hidden', !isTyping);
        }
    });

    socket.on('user_status', ({ userId, status, presence }) => {
        const convItem = document.querySelector(`.conversation-item[data-user-id="${userId}"]`);
        if (convItem) {
            const statusIndicator = convItem.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.className = `status-indicator ${presence || status}`;
            }
        }
        if (currentConversation?.other_user?.id === userId) {
            updateChatStatus(status, presence);
        }
    });

    socket.on('friend_request', (data) => {
        friendRequests.push(data);
        updateFriendRequestBadge();
        showToast(`${data.username} t'a envoyé une demande d'ami !`, 'info');
        // Play notification sound if available
        try {
            const audio = new Audio('/notification.mp3');
            audio.volume = 0.3;
            audio.play().catch(() => { });
        } catch (e) { }
    });

    socket.on('friend_accepted', (data) => {
        loadFriends();
        showToast(`${data.username || 'Un ami'} a accepté ta demande !`, 'success');
    });

    // WebRTC handlers
    socket.on('incoming_call', async ({ callerId, callerUsername, callType }) => {
        callPartner = { id: callerId, username: callerUsername };
        currentCallType = callType;
        document.getElementById('caller-avatar').textContent = callerUsername.charAt(0).toUpperCase();
        document.getElementById('caller-username').textContent = callerUsername;
        document.getElementById('call-type-text').textContent = callType === 'video' ? 'Appel vidéo entrant...' : 'Appel audio entrant...';
        document.getElementById('incoming-call-modal').classList.remove('hidden');
    });

    socket.on('call_accepted', async ({ recipientId }) => {
        await createPeerConnection();
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: currentCallType === 'video'
            });
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            if (currentCallType === 'video') {
                document.getElementById('local-video').srcObject = localStream;
            }
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('call_offer', { targetUserId: callPartner.id, offer });
            showActiveCallUI();
        } catch (error) {
            console.error('Error:', error);
            endCurrentCall();
        }
    });

    socket.on('call_rejected', () => {
        showToast("L'utilisateur a refusé l'appel.", 'info');
        cleanupCall();
    });

    socket.on('call_offer', async ({ callerId, offer }) => {
        await createPeerConnection();
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: currentCallType === 'video'
            });
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            if (currentCallType === 'video') {
                document.getElementById('local-video').srcObject = localStream;
            }
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('call_answer', { callerId, answer });
            showActiveCallUI();
        } catch (error) {
            console.error('Error:', error);
            endCurrentCall();
        }
    });

    socket.on('call_answer', async ({ answer }) => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error('Error:', error);
        }
    });

    socket.on('ice_candidate', async ({ candidate }) => {
        try {
            if (peerConnection && candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });

    socket.on('call_ended', () => cleanupCall());
    socket.on('call_failed', ({ reason }) => {
        if (reason === 'user_offline') showToast("L'utilisateur est hors ligne.", 'error');
        cleanupCall();
    });
}

// ==================== CONVERSATIONS ====================
async function loadConversations() {
    try {
        const res = await fetch('/api/conversations', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        conversations = await res.json();
        renderConversations();
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
}

function renderConversations() {
    const list = document.getElementById('conversations-list');
    list.innerHTML = conversations.map(conv => {
        const isGroup = conv.type === 'group';
        const isActive = currentConversation && currentConversation.id === conv.id;
        const lastMessage = conv.last_message;
        let preview = '';
        let displayName = '';
        let avatarHtml = '';

        if (isGroup) {
            displayName = conv.name || 'Groupe';
            const members = conv.participants.slice(0, 4);
            avatarHtml = `<div class="conversation-avatar group"><div class="group-avatars">
                ${members.map(m => `<div class="mini-avatar">${(m.username || '?').charAt(0).toUpperCase()}</div>`).join('')}
            </div></div>`;
        } else {
            const other = conv.other_user || conv.participants[0];
            if (!other) return '';
            displayName = other.username;
            avatarHtml = `<div class="conversation-avatar">
                ${other.avatar ? `<img src="${other.avatar}" alt="">` : other.username.charAt(0).toUpperCase()}
                <span class="status-indicator ${other.presence || other.status || 'offline'}"></span>
            </div>`;
        }

        if (lastMessage) {
            const typeIcons = { image: '📷 Image', video: '🎥 Vidéo', audio: '🎤 Vocal', file: '📎 Fichier' };
            preview = typeIcons[lastMessage.type] || (lastMessage.content?.substring(0, 30) + (lastMessage.content?.length > 30 ? '...' : ''));
        }

        return `
            <div class="conversation-item ${isActive ? 'active' : ''}" 
                 data-id="${conv.id}" 
                 data-user-id="${isGroup ? '' : (conv.other_user?.id || '')}"
                 onclick="selectConversation('${conv.id}')">
                ${avatarHtml}
                <div class="conversation-info">
                    <div class="name">${escapeHtml(displayName)}</div>
                    ${preview ? `<div class="last-message">${escapeHtml(preview)}</div>` : ''}
                </div>
                ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
            </div>
        `;
    }).join('');
}

async function selectConversation(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    currentConversation = conv;

    document.getElementById('no-conversation').classList.add('hidden');
    document.getElementById('friends-panel').classList.add('hidden');
    document.getElementById('active-conversation').classList.remove('hidden');

    const isGroup = conv.type === 'group';
    const displayName = isGroup ? conv.name : (conv.other_user?.username || 'Utilisateur');

    document.getElementById('chat-username').textContent = displayName;
    document.getElementById('message-input').placeholder = `Envoyer un message à @${displayName}`;

    if (!isGroup && conv.other_user) {
        updateChatStatus(conv.other_user.status, conv.other_user.presence);
    } else {
        document.getElementById('chat-user-status').textContent = `${conv.participants?.length || 0} membres`;
    }

    document.getElementById('conv-start-username').textContent = displayName;
    document.getElementById('conv-start-name').textContent = displayName;
    document.getElementById('conv-start-avatar').textContent = displayName.charAt(0).toUpperCase();

    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === id);
    });

    document.getElementById('nav-friends').classList.remove('active');
    document.getElementById('group-settings-btn').style.display = isGroup ? 'flex' : 'none';

    await loadMessages(id);
    markMessagesAsRead(id);
}

function updateChatStatus(status, presence) {
    const statusEl = document.getElementById('chat-user-status');
    const p = presence || status;
    const statusMap = { online: 'En ligne', offline: 'Hors ligne', idle: 'Absent', dnd: 'Ne pas déranger' };
    statusEl.textContent = statusMap[p] || 'Hors ligne';
    statusEl.style.color = p === 'online' ? 'var(--status-online)' : 'var(--text-muted)';
}

// ==================== MESSAGES ====================
async function loadMessages(conversationId) {
    try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const messages = await res.json();
        renderMessages(messages);
        scrollToBottom();
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function renderMessages(messages) {
    document.getElementById('messages-list').innerHTML = messages.map(msg => createMessageHtml(msg)).join('');
}

function appendMessage(message) {
    document.getElementById('messages-list').insertAdjacentHTML('beforeend', createMessageHtml(message));
}

function createMessageHtml(msg) {
    const time = formatTime(msg.created_at);
    let contentHtml = '';

    // Reply preview
    let replyHtml = '';
    if (msg.reply) {
        const replyContent = msg.reply.type === 'text' ? msg.reply.content?.substring(0, 50) : `[${msg.reply.type}]`;
        replyHtml = `
            <div class="message-reply" onclick="scrollToMessage('${msg.reply.id}')">
                <span class="reply-username">@${escapeHtml(msg.reply.username || 'Utilisateur')}</span>
                <span class="reply-content">${escapeHtml(replyContent || '')}</span>
            </div>`;
    }

    // Forwarded indicator
    let forwardedHtml = msg.forwarded_from ? '<div class="message-forwarded">↪ Message transféré</div>' : '';

    // Content based on type
    if (msg.type === 'image') {
        contentHtml = `<div class="message-media"><img src="${msg.file_url}" alt="Image" onclick="viewImage('${msg.file_url}')"></div>`;
    } else if (msg.type === 'video') {
        contentHtml = `<div class="message-media"><video controls preload="metadata"><source src="${msg.file_url}" type="video/mp4"></video></div>`;
    } else if (msg.type === 'file') {
        contentHtml = `
            <div class="message-file">
                <div class="message-file-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg></div>
                <div class="message-file-info">
                    <a href="${msg.file_url}" class="message-file-name" target="_blank" download>${escapeHtml(msg.file_name || 'Fichier')}</a>
                    <span class="message-file-size">${formatFileSize(msg.file_size || 0)}</span>
                </div>
            </div>`;
    } else if (msg.type === 'audio') {
        // Generate more aesthetic waveform pattern
        let bars = '';
        for (let i = 0; i < 40; i++) {
            const height = Math.sin(i * 0.3) * 12 + Math.random() * 8 + 10;
            bars += `<div class="audio-waveform-bar" data-index="${i}" style="height:${Math.floor(height)}px;"></div>`;
        }
        contentHtml = `
            <div class="message-audio" id="audio-${msg.id}">
                <button class="audio-play-btn" onclick="playAudio('${msg.id}', '${msg.file_url}')">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                </button>
                <div class="audio-waveform">${bars}</div>
                <span class="audio-duration">0:00</span>
            </div>`;
    } else {
        contentHtml = `<div class="message-text">${formatMessageContent(msg.content)}</div>`;
    }

    const pendingClass = msg.pending ? ' pending' : '';
    return `
        <div class="message${pendingClass}" data-id="${msg.id}" data-content="${escapeHtml(msg.content || '')}" oncontextmenu="showContextMenu(event, '${msg.id}', '${escapeHtml(msg.content || '')}')">
            <div class="message-avatar">
                ${msg.sender_avatar ? `<img src="${msg.sender_avatar}" alt="">` : (msg.sender_username || 'U').charAt(0).toUpperCase()}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${escapeHtml(msg.sender_username || 'Utilisateur')}</span>
                    <span class="message-timestamp">${time}${msg.pending ? ' <span class="sending-indicator">Envoi...</span>' : ''}</span>
                </div>
                ${replyHtml}${forwardedHtml}${contentHtml}
            </div>
            <div class="message-actions">
                <button onclick="startReply('${msg.id}')" title="Répondre"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg></button>
                <button onclick="openForwardModal('${msg.id}')" title="Transférer"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg></button>
            </div>
        </div>`;
}

function formatMessageContent(content) {
    if (!content) return '';
    let html = escapeHtml(content);
    // Format mentions
    html = html.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    return html;
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content || !currentConversation) return;

    // Create optimistic message for immediate display
    const tempId = 'temp-' + Date.now();
    const optimisticMessage = {
        id: tempId,
        content,
        sender_id: currentUser.id,
        sender_username: currentUser.username,
        sender_avatar: currentUser.avatar,
        conversation_id: currentConversation.id,
        created_at: new Date().toISOString(),
        type: 'text',
        pending: true
    };

    // Handle reply preview for optimistic message
    if (replyingTo) {
        optimisticMessage.reply = {
            id: replyingTo.id,
            username: replyingTo.username,
            content: replyingTo.content,
            type: 'text'
        };
    }

    // Display immediately
    appendMessage(optimisticMessage);
    scrollToBottom();

    input.value = '';
    input.style.height = 'auto';
    sendTypingIndicator(false);
    document.getElementById('mention-autocomplete').classList.add('hidden');

    const body = {
        conversationId: currentConversation.id,
        content,
        type: 'text'
    };

    if (replyingTo) {
        body.replyToId = replyingTo.id;
        cancelReply();
    }

    // Extract mentions
    const mentionMatches = content.match(/@(\w+)/g);
    if (mentionMatches && currentConversation.participants) {
        const mentionedUsers = currentConversation.participants
            .filter(p => mentionMatches.some(m => m.toLowerCase() === `@${p.username.toLowerCase()}`))
            .map(p => p.id);
        if (mentionedUsers.length > 0) body.mentions = mentionedUsers;
    }

    try {
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (error) {
        console.error('Failed to send message:', error);
        // Remove pending message on error
        const pendingMsg = document.querySelector(`.message[data-id="${tempId}"]`);
        if (pendingMsg) {
            pendingMsg.classList.add('error');
            pendingMsg.querySelector('.message-text').innerHTML += ' <span style="color: var(--status-dnd); font-size: 12px;">(Erreur d\'envoi)</span>';
        }
    }
}

function sendTypingIndicator(isTyping) {
    if (socket && currentConversation) {
        socket.emit('typing', { conversationId: currentConversation.id, isTyping });
    }
}

async function markMessagesAsRead(conversationId) {
    try {
        await fetch(`/api/messages/${conversationId}/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const conv = conversations.find(c => c.id === conversationId);
        if (conv) {
            conv.unread_count = 0;
            renderConversations();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==================== REPLY & FORWARD ====================
function startReply(messageId) {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (!msgEl) return;
    const username = msgEl.querySelector('.message-username')?.textContent || 'Utilisateur';
    const content = msgEl.dataset.content || '';

    replyingTo = { id: messageId, username, content };

    document.getElementById('reply-to-username').textContent = username;
    document.getElementById('reply-to-text').textContent = content.substring(0, 100);
    document.getElementById('reply-preview').classList.remove('hidden');
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-preview').classList.add('hidden');
}

function openForwardModal(messageId) {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (!msgEl) return;
    forwardingMessage = messageId;

    const content = msgEl.dataset.content || '[Média]';
    document.getElementById('forward-preview').textContent = content;

    const forwardList = document.getElementById('forward-conversations');
    forwardList.innerHTML = conversations.filter(c => c.id !== currentConversation?.id).map(conv => {
        const name = conv.type === 'group' ? conv.name : (conv.other_user?.username || 'Conversation');
        return `
            <div class="forward-conversation-item" onclick="forwardMessage('${conv.id}')">
                <div class="conversation-avatar">${name.charAt(0).toUpperCase()}</div>
                <span>${escapeHtml(name)}</span>
            </div>`;
    }).join('');

    document.getElementById('forward-modal').classList.remove('hidden');
}

function closeForwardModal() {
    forwardingMessage = null;
    document.getElementById('forward-modal').classList.add('hidden');
}

async function forwardMessage(targetConversationId) {
    if (!forwardingMessage) return;
    try {
        await fetch('/api/messages/forward', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: forwardingMessage, targetConversationId })
        });
        closeForwardModal();
    } catch (error) {
        console.error('Error:', error);
    }
}

function filterForwardConversations() {
    const query = document.getElementById('forward-search').value.toLowerCase();
    document.querySelectorAll('.forward-conversation-item').forEach(item => {
        const name = item.textContent.toLowerCase();
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

function scrollToMessage(messageId) {
    const el = document.querySelector(`.message[data-id="${messageId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.background = 'rgba(88, 101, 242, 0.2)';
        setTimeout(() => el.style.background = '', 2000);
    }
}

// ==================== CONTEXT MENU ====================
function showContextMenu(e, messageId, content) {
    e.preventDefault();
    window.contextMenuMessageId = messageId;
    window.contextMenuContent = content;
    const menu = document.getElementById('context-menu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
}

function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
}

// ==================== MESSAGE SEARCH ====================
function openMessageSearch() {
    document.getElementById('message-search-modal').classList.remove('hidden');
    document.getElementById('message-search-input').focus();
}

function closeMessageSearch() {
    document.getElementById('message-search-modal').classList.add('hidden');
    document.getElementById('message-search-input').value = '';
    document.getElementById('message-search-results').innerHTML = '';
}

async function searchMessages() {
    const query = document.getElementById('message-search-input').value.trim();
    if (!query || !currentConversation) return;

    try {
        const res = await fetch(`/api/messages/search?conversationId=${currentConversation.id}&q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await res.json();

        document.getElementById('message-search-results').innerHTML = messages.map(msg => `
            <div class="message-search-result" onclick="scrollToMessage('${msg.id}'); closeMessageSearch();">
                <div class="result-header">
                    <span class="result-username">${escapeHtml(msg.sender_username)}</span>
                    <span class="result-time">${formatTime(msg.created_at)}</span>
                </div>
                <div class="result-content">${highlightText(msg.content, query)}</div>
            </div>
        `).join('') || '<p style="padding:16px;color:var(--text-muted);">Aucun résultat</p>';
    } catch (error) {
        console.error('Error:', error);
    }
}

function highlightText(text, query) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeHtml(query)})`, 'gi');
    return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}

// ==================== MENTION AUTOCOMPLETE ====================
function handleMentionAutocomplete(text) {
    const match = text.match(/@(\w*)$/);
    const autocomplete = document.getElementById('mention-autocomplete');

    if (!match || !currentConversation?.participants) {
        autocomplete.classList.add('hidden');
        return;
    }

    const query = match[1].toLowerCase();
    const filtered = currentConversation.participants.filter(p =>
        p.username.toLowerCase().includes(query) && p.id !== currentUser.id
    );

    if (filtered.length === 0) {
        autocomplete.classList.add('hidden');
        return;
    }

    autocomplete.innerHTML = filtered.slice(0, 5).map(p => `
        <div class="mention-item" onclick="insertMention('${p.username}')">
            <div class="mention-avatar">${p.avatar ? `<img src="${p.avatar}" style="width:100%;height:100%;border-radius:50%;">` : p.username.charAt(0).toUpperCase()}</div>
            <span class="mention-name">${escapeHtml(p.username)}</span>
        </div>
    `).join('');
    autocomplete.classList.remove('hidden');
}

function insertMention(username) {
    const input = document.getElementById('message-input');
    input.value = input.value.replace(/@\w*$/, `@${username} `);
    input.focus();
    document.getElementById('mention-autocomplete').classList.add('hidden');
}

// ==================== FRIENDS ====================
async function loadFriends() {
    try {
        const res = await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } });
        friends = await res.json();
    } catch (e) { console.error(e); }
}

async function loadFriendRequests() {
    try {
        const res = await fetch('/api/friends/requests', { headers: { 'Authorization': `Bearer ${token}` } });
        friendRequests = await res.json();
        updateFriendRequestBadge();
    } catch (e) { console.error(e); }
}

function updateFriendRequestBadge() {
    const badge = document.getElementById('friend-request-badge');
    if (friendRequests.length > 0) {
        badge.textContent = friendRequests.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function showFriendsPanel() {
    document.getElementById('no-conversation').classList.add('hidden');
    document.getElementById('active-conversation').classList.add('hidden');
    document.getElementById('friends-panel').classList.remove('hidden');
    document.getElementById('nav-friends').classList.add('active');
    document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
    currentConversation = null;
    switchFriendsTab('all');
}

function switchFriendsTab(tab) {
    currentFriendsTab = tab;
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('friends-list').classList.toggle('hidden', tab === 'add');
    document.getElementById('add-friend-form').classList.toggle('hidden', tab !== 'add');
    if (tab !== 'add') renderFriendsList(tab);
}

function renderFriendsList(tab) {
    let list = [];
    if (tab === 'all') list = friends.filter(f => f.status === 'accepted');
    else if (tab === 'online') list = friends.filter(f => f.status === 'accepted' && f.presence === 'online');
    else if (tab === 'pending') list = friendRequests;
    else if (tab === 'blocked') { loadBlockedUsers(); return; }

    document.getElementById('friends-list').innerHTML = list.length === 0
        ? '<p style="padding:16px;color:var(--text-muted);">Aucun résultat</p>'
        : list.map(f => {
            const user = f.from_user_id ? f : { username: f.username, avatar: f.avatar, friend_user_id: f.friend_user_id };
            const isPending = tab === 'pending';
            return `
                <div class="friend-item">
                    <div class="friend-avatar">${user.avatar ? `<img src="${user.avatar}">` : (user.username || '?').charAt(0).toUpperCase()}</div>
                    <div class="friend-info">
                        <div class="friend-name">${escapeHtml(user.username || 'Utilisateur')}</div>
                        <div class="friend-status">${isPending ? 'Demande en attente' : (f.custom_status || '')}</div>
                    </div>
                    <div class="friend-actions">
                        ${isPending ? `
                            <button onclick="acceptFriendRequest('${f.id}')" title="Accepter"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></button>
                            <button onclick="rejectFriendRequest('${f.id}')" title="Refuser"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
                        ` : `
                            <button onclick="startConversationWithFriend('${user.friend_user_id || f.friend_id}')" title="Message"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></button>
                        `}
                    </div>
                </div>`;
        }).join('');
}

async function loadBlockedUsers() {
    try {
        const res = await fetch('/api/blocks', { headers: { 'Authorization': `Bearer ${token}` } });
        blockedUsers = await res.json();
        document.getElementById('friends-list').innerHTML = blockedUsers.length === 0
            ? '<p style="padding:16px;color:var(--text-muted);">Aucun utilisateur bloqué</p>'
            : blockedUsers.map(b => `
                <div class="friend-item">
                    <div class="friend-avatar">${b.avatar ? `<img src="${b.avatar}">` : b.username.charAt(0).toUpperCase()}</div>
                    <div class="friend-info"><div class="friend-name">${escapeHtml(b.username)}</div></div>
                    <div class="friend-actions">
                        <button class="btn-secondary" onclick="unblockUser('${b.blocked_user_id}')">Débloquer</button>
                    </div>
                </div>`).join('');
    } catch (e) { console.error(e); }
}

async function sendFriendRequest() {
    const input = document.getElementById('add-friend-username');
    const value = input.value.trim();
    if (!value) return;

    // Check if it's a link code
    if (value.length === 8 && !value.includes(' ')) {
        try {
            const res = await fetch(`/api/friends/link/${value}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) { showToast('Ami ajouté !', 'success'); loadFriends(); }
            else { const d = await res.json(); showToast(d.error || 'Erreur', 'error'); }
        } catch (e) { showToast('Erreur', 'error'); }
        return;
    }

    // Search by username and send request
    try {
        const searchRes = await fetch(`/api/users/search?q=${encodeURIComponent(value)}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await searchRes.json();
        const user = users.find(u => u.username.toLowerCase() === value.toLowerCase());
        if (!user) { showToast('Utilisateur non trouvé', 'error'); return; }

        const res = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id })
        });
        if (res.ok) { showToast('Demande envoyée !', 'success'); input.value = ''; }
        else { const d = await res.json(); showToast(d.error, 'error'); }
    } catch (e) { showToast('Erreur', 'error'); }
}

async function acceptFriendRequest(requestId) {
    try {
        await fetch('/api/friends/accept', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId })
        });
        await loadFriends();
        await loadFriendRequests();
        renderFriendsList('pending');
    } catch (e) { console.error(e); }
}

async function rejectFriendRequest(requestId) {
    try {
        await fetch('/api/friends/reject', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId })
        });
        await loadFriendRequests();
        renderFriendsList('pending');
    } catch (e) { console.error(e); }
}

async function unblockUser(userId) {
    try {
        await fetch(`/api/blocks/${userId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        loadBlockedUsers();
    } catch (e) { console.error(e); }
}

async function generateFriendLink() {
    try {
        const res = await fetch('/api/friends/link', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('my-friend-link').value = data.code;
    } catch (e) { console.error(e); }
}

function copyFriendLink() {
    const input = document.getElementById('my-friend-link');
    if (input.value) {
        navigator.clipboard.writeText(input.value);
        showToast('Lien copié !', 'success');
    }
}

async function startConversationWithFriend(userId) {
    await startConversation(userId);
}

// ==================== USER SEARCH ====================
async function searchUsers(query) {
    try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await res.json();
        const results = document.getElementById('search-results');
        results.innerHTML = users.length === 0
            ? '<p style="padding:16px;color:var(--text-muted);">Aucun utilisateur trouvé</p>'
            : users.map(u => `
                <div class="search-result-item" onclick="startConversation('${u.id}')">
                    <div class="search-result-avatar">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : u.username.charAt(0).toUpperCase()}</div>
                    <div class="search-result-info">
                        <div class="search-result-name">${escapeHtml(u.username)}</div>
                        <div class="search-result-status">${u.status === 'online' ? 'En ligne' : 'Hors ligne'}</div>
                    </div>
                </div>`).join('');
        document.getElementById('search-modal').classList.remove('hidden');
    } catch (e) { console.error(e); }
}

async function startConversation(userId) {
    try {
        const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        document.getElementById('search-modal').classList.add('hidden');
        document.getElementById('user-search').value = '';
        await loadConversations();
        selectConversation(data.id);
    } catch (e) { console.error(e); }
}

// ==================== GROUP DMS ====================
function openCreateGroupModal() {
    selectedGroupMembers = [];
    document.getElementById('group-name').value = '';
    document.getElementById('group-members-search').value = '';
    document.getElementById('group-members-results').innerHTML = '';
    document.getElementById('selected-members-list').innerHTML = '';
    document.getElementById('selected-count').textContent = '0';
    document.getElementById('create-group-modal').classList.remove('hidden');
}

function closeCreateGroupModal() {
    document.getElementById('create-group-modal').classList.add('hidden');
}

async function searchGroupMembers() {
    const query = document.getElementById('group-members-search').value.trim();
    if (query.length < 2) { document.getElementById('group-members-results').innerHTML = ''; return; }

    const acceptedFriends = friends.filter(f => f.status === 'accepted');
    const filtered = acceptedFriends.filter(f => f.username.toLowerCase().includes(query.toLowerCase()));

    document.getElementById('group-members-results').innerHTML = filtered.map(f => `
        <div class="group-member-item ${selectedGroupMembers.some(m => m.id === f.friend_user_id) ? 'selected' : ''}" onclick="toggleGroupMember('${f.friend_user_id}', '${escapeHtml(f.username)}')">
            <div class="member-avatar">${f.avatar ? `<img src="${f.avatar}" style="width:100%;height:100%;border-radius:50%;">` : f.username.charAt(0).toUpperCase()}</div>
            <span class="member-name">${escapeHtml(f.username)}</span>
        </div>`).join('');
}

function toggleGroupMember(id, username) {
    const idx = selectedGroupMembers.findIndex(m => m.id === id);
    if (idx >= 0) selectedGroupMembers.splice(idx, 1);
    else if (selectedGroupMembers.length < 9) selectedGroupMembers.push({ id, username });
    updateSelectedMembers();
    searchGroupMembers();
}

function updateSelectedMembers() {
    document.getElementById('selected-count').textContent = selectedGroupMembers.length;
    document.getElementById('selected-members-list').innerHTML = selectedGroupMembers.map(m => `
        <div class="selected-member-chip">
            <div class="chip-avatar">${m.username.charAt(0).toUpperCase()}</div>
            <span>${escapeHtml(m.username)}</span>
            <button class="remove-chip" onclick="toggleGroupMember('${m.id}', '${escapeHtml(m.username)}')">&times;</button>
        </div>`).join('');
}

async function createGroup() {
    const name = document.getElementById('group-name').value.trim() || 'Nouveau groupe';
    if (selectedGroupMembers.length === 0) { showToast('Ajoutez au moins un membre', 'error'); return; }

    try {
        const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'group', name, userIds: selectedGroupMembers.map(m => m.id) })
        });
        const data = await res.json();
        closeCreateGroupModal();
        await loadConversations();
        selectConversation(data.id);
    } catch (e) { console.error(e); showToast('Erreur', 'error'); }
}

// ==================== FILE UPLOAD ====================
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { showToast('Fichier trop volumineux (max 50MB)', 'error'); document.getElementById('file-input').value = ''; return; }
    pendingFile = file;
    showFilePreview(file);
}

function showFilePreview(file) {
    const content = document.getElementById('file-preview-content');
    let preview = '';
    if (file.type.startsWith('image/')) preview = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
    else if (file.type.startsWith('video/')) preview = `<video controls><source src="${URL.createObjectURL(file)}"></video>`;
    else preview = `<div class="message-file" style="display:inline-flex;"><div class="message-file-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg></div><div class="message-file-info"><span class="message-file-name">${escapeHtml(file.name)}</span><span class="message-file-size">${formatFileSize(file.size)}</span></div></div>`;
    content.innerHTML = preview + `<p class="file-preview-name">${escapeHtml(file.name)} (${formatFileSize(file.size)})</p>`;
    document.getElementById('file-preview-modal').classList.remove('hidden');
}

function closeFilePreview() {
    document.getElementById('file-preview-modal').classList.add('hidden');
    pendingFile = null;
    document.getElementById('file-input').value = '';
}

async function uploadFile() {
    if (!pendingFile || !currentConversation) return;
    const formData = new FormData();
    formData.append('file', pendingFile);
    const btn = document.getElementById('confirm-upload');
    try {
        btn.disabled = true; btn.textContent = 'Envoi...';
        const uploadRes = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
        if (!uploadRes.ok) throw new Error();
        const fileData = await uploadRes.json();
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentConversation.id, content: fileData.name, type: fileData.type, fileUrl: fileData.url, fileName: fileData.name, fileSize: fileData.size })
        });
        closeFilePreview();
    } catch (e) { showToast('Erreur lors de l\'envoi', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Envoyer'; }
}

// ==================== SETTINGS ====================
let pendingAvatarFile = null;
let pendingBannerFile = null;

function openSettings() {
    if (!currentUser) return;
    document.getElementById('settings-username').value = currentUser.username;
    document.getElementById('settings-bio').value = currentUser.bio || '';
    document.getElementById('settings-custom-status').value = currentUser.custom_status || '';
    document.getElementById('settings-custom-status-emoji').value = currentUser.custom_status_emoji || '';

    // Set presence using radio buttons
    const presenceValue = currentUser.presence || 'online';
    const presenceRadio = document.querySelector(`input[name="presence"][value="${presenceValue}"]`);
    if (presenceRadio) presenceRadio.checked = true;

    const links = currentUser.social_links || {};
    document.getElementById('social-spotify').value = links.spotify || '';
    document.getElementById('social-steam').value = links.steam || '';
    document.getElementById('social-twitch').value = links.twitch || '';
    if (document.getElementById('social-github')) {
        document.getElementById('social-github').value = links.github || '';
    }

    // Update avatar in both edit and preview sections
    const avatar = document.getElementById('settings-avatar');
    const avatarContent = currentUser.avatar ? `<img src="${currentUser.avatar}">` : currentUser.username.charAt(0).toUpperCase();
    avatar.innerHTML = avatarContent;

    const previewAvatar = document.getElementById('preview-avatar');
    if (previewAvatar) previewAvatar.innerHTML = avatarContent;

    // Update banner in both edit and preview sections
    const banner = document.getElementById('settings-banner');
    const bannerStyle = currentUser.banner ? `url(${currentUser.banner})` : '';
    banner.style.backgroundImage = bannerStyle;

    const previewBanner = document.getElementById('preview-banner');
    if (previewBanner) previewBanner.style.backgroundImage = bannerStyle;

    // Update preview card
    const previewUsername = document.getElementById('preview-username');
    if (previewUsername) previewUsername.textContent = currentUser.username;

    const previewBio = document.getElementById('preview-bio');
    if (previewBio) previewBio.textContent = currentUser.bio || 'Aucune bio';

    const previewCustomStatus = document.getElementById('preview-custom-status');
    if (previewCustomStatus) {
        const emoji = currentUser.custom_status_emoji || '';
        const status = currentUser.custom_status || '';
        previewCustomStatus.textContent = emoji + ' ' + status;
    }

    // Update bio character count
    const bioCount = document.getElementById('bio-count');
    if (bioCount) bioCount.textContent = (currentUser.bio || '').length;

    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

function handleAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image trop grande (max 5MB)', 'error'); return; }
    pendingAvatarFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => { document.getElementById('settings-avatar').innerHTML = `<img src="${ev.target.result}">`; };
    reader.readAsDataURL(file);
}

function handleBannerSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Image trop grande (max 10MB)', 'error'); return; }
    pendingBannerFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => { document.getElementById('settings-banner').style.backgroundImage = `url(${ev.target.result})`; };
    reader.readAsDataURL(file);
}

async function saveUserSettings() {
    const btn = document.getElementById('save-settings');
    btn.disabled = true; btn.textContent = 'Sauvegarde...';
    try {
        let avatarUrl = currentUser.avatar, bannerUrl = currentUser.banner;
        if (pendingAvatarFile) {
            const fd = new FormData(); fd.append('file', pendingAvatarFile);
            const r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
            if (r.ok) { const d = await r.json(); avatarUrl = d.url; }
        }
        if (pendingBannerFile) {
            const fd = new FormData(); fd.append('file', pendingBannerFile);
            const r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
            if (r.ok) { const d = await r.json(); bannerUrl = d.url; }
        }
        const body = {
            username: document.getElementById('settings-username').value.trim(),
            avatar: avatarUrl, banner: bannerUrl,
            bio: document.getElementById('settings-bio').value,
            custom_status: document.getElementById('settings-custom-status').value,
            custom_status_emoji: document.getElementById('settings-custom-status-emoji').value,
            presence: document.querySelector('input[name="presence"]:checked')?.value || 'online',
            social_links: {
                spotify: document.getElementById('social-spotify').value,
                steam: document.getElementById('social-steam').value,
                twitch: document.getElementById('social-twitch').value
            }
        };
        const res = await fetch('/api/users/profile', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            currentUser = await res.json();
            document.getElementById('current-username').textContent = currentUser.username;
            updateUserAvatar(); updateStatusText();
            if (socket && currentUser.presence) socket.emit('presence_change', { presence: currentUser.presence });
            pendingAvatarFile = null; pendingBannerFile = null;
            closeSettingsModal();
            showToast('Profil mis à jour !', 'success');
        }
    } catch (e) { showToast('Erreur', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Sauvegarder'; }
}

// ==================== VOICE RECORDING ====================
async function startVoiceRecording() {
    if (!currentConversation) { showToast('Sélectionnez une conversation', 'error'); return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        audioContext.createMediaStreamSource(stream).connect(analyser);
        analyser.fftSize = 64;

        const wf = document.getElementById('voice-waveform');
        wf.innerHTML = ''; waveformBars = [];
        for (let i = 0; i < 30; i++) {
            const bar = document.createElement('div');
            bar.className = 'waveform-bar'; bar.style.height = '4px';
            wf.appendChild(bar); waveformBars.push(bar);
        }
        visualizeAudio();

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start(100);
        recordingStartTime = Date.now();
        recordingTimer = setInterval(() => {
            const s = Math.floor((Date.now() - recordingStartTime) / 1000);
            document.getElementById('recording-time').textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
        }, 1000);
        document.getElementById('voice-btn')?.classList.add('recording');
        document.getElementById('voice-recording-modal').classList.remove('hidden');
    } catch (e) { showToast('Impossible d\'accéder au microphone', 'error'); }
}

function visualizeAudio() {
    if (!analyser || !waveformBars.length) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    (function draw() {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
        analyser.getByteFrequencyData(data);
        waveformBars.forEach((bar, i) => bar.style.height = `${Math.max(4, (data[i] || 0) / 255 * 50)}px`);
        requestAnimationFrame(draw);
    })();
}

function cancelVoiceRecording() {
    if (mediaRecorder?.state !== 'inactive') { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
    clearInterval(recordingTimer);
    audioContext?.close(); audioContext = null;
    mediaRecorder = null; audioChunks = [];
    document.getElementById('voice-btn')?.classList.remove('recording');
    document.getElementById('voice-recording-modal').classList.add('hidden');
    document.getElementById('recording-time').textContent = '0:00';
}

async function sendVoiceMessage() {
    if (!mediaRecorder) return;

    // Create a promise that resolves when recording actually stops
    const recordingStopPromise = new Promise(resolve => {
        mediaRecorder.onstop = () => {
            resolve();
        };
    });

    // Stop recording
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    clearInterval(recordingTimer);
    audioContext?.close();
    audioContext = null;

    // Wait for the stop event to fire and chunks to be finalized
    await recordingStopPromise;

    // Check if we have audio data
    if (audioChunks.length === 0) {
        showToast('Enregistrement vide', 'error');
        cleanupVoiceUI();
        return;
    }

    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
    const fd = new FormData();
    fd.append('file', blob, `voice-${Date.now()}.webm`);

    const btn = document.getElementById('send-voice');
    try {
        if (btn) btn.disabled = true;
        const r = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });

        if (!r.ok) throw new Error();
        const data = await r.json();

        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: currentConversation.id,
                content: `Vocal (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})`,
                type: 'audio',
                fileUrl: data.url,
                fileName: data.name,
                fileSize: data.size
            })
        });
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de l\'envoi du vocal', 'error');
    } finally {
        if (btn) btn.disabled = false;
        cleanupVoiceUI();
    }
}

function cleanupVoiceUI() {
    mediaRecorder = null;
    audioChunks = [];
    document.getElementById('voice-btn')?.classList.remove('recording');
    document.getElementById('voice-recording-modal').classList.add('hidden');
    document.getElementById('recording-time').textContent = '0:00';
}

// ==================== WEBRTC CALLS ====================
function initiateCall(type) {
    if (!currentConversation) { showToast('Sélectionnez une conversation', 'error'); return; }
    currentCallType = type;
    callPartner = currentConversation.other_user;
    socket.emit('call_request', { targetUserId: callPartner.id, callerUsername: currentUser.username, callType: type });
    document.getElementById('call-partner-name').textContent = callPartner.username;
    document.getElementById('call-partner-avatar').textContent = callPartner.username.charAt(0).toUpperCase();
    document.getElementById('call-duration').textContent = 'Appel en cours...';
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(iceServers);
    peerConnection.onicecandidate = (e) => { if (e.candidate && callPartner) socket.emit('ice_candidate', { targetUserId: callPartner.id, candidate: e.candidate }); };
    peerConnection.ontrack = (e) => { remoteStream = e.streams[0]; document.getElementById('remote-video').srcObject = remoteStream; };
    peerConnection.onconnectionstatechange = () => { if (peerConnection.connectionState === 'connected') startCallTimer(); };
}

function acceptIncomingCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    socket.emit('call_accept', { callerId: callPartner.id });
}

function rejectIncomingCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    socket.emit('call_reject', { callerId: callPartner.id });
    callPartner = null; currentCallType = null;
}

function showActiveCallUI() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    document.getElementById('active-call-modal').classList.remove('hidden');
    if (callPartner) { document.getElementById('call-partner-name').textContent = callPartner.username; document.getElementById('call-partner-avatar').textContent = callPartner.username.charAt(0).toUpperCase(); }
}

function startCallTimer() {
    callStartTime = Date.now();
    callDurationTimer = setInterval(() => {
        const s = Math.floor((Date.now() - callStartTime) / 1000);
        document.getElementById('call-duration').textContent = `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    }, 1000);
}

function toggleMuteAudio() {
    if (localStream) {
        const t = localStream.getAudioTracks()[0];
        if (t) { isMuted = !isMuted; t.enabled = !isMuted; document.getElementById('toggle-mute')?.classList.toggle('muted', isMuted); }
    }
}

function toggleVideoStream() {
    if (localStream) {
        const t = localStream.getVideoTracks()[0];
        if (t) { isVideoOff = !isVideoOff; t.enabled = !isVideoOff; document.getElementById('toggle-video')?.classList.toggle('video-off', isVideoOff); }
    }
}

function endCurrentCall() { if (callPartner) socket.emit('call_end', { targetUserId: callPartner.id }); cleanupCall(); }

function cleanupCall() {
    localStream?.getTracks().forEach(t => t.stop()); localStream = null;
    peerConnection?.close(); peerConnection = null;
    clearInterval(callDurationTimer); callDurationTimer = null;
    document.getElementById('active-call-modal').classList.add('hidden');
    document.getElementById('incoming-call-modal').classList.add('hidden');
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('call-duration').textContent = '00:00';
    callPartner = null; currentCallType = null; isMuted = false; isVideoOff = false;
    document.getElementById('toggle-mute')?.classList.remove('muted');
    document.getElementById('toggle-video')?.classList.remove('video-off');
}

// ==================== UTILITIES ====================
function viewImage(url) { document.getElementById('image-viewer-img').src = url; document.getElementById('image-viewer-modal').classList.remove('hidden'); }
function scrollToBottom() { const c = document.getElementById('messages-container'); c.scrollTop = c.scrollHeight; }
function formatTime(dateString) {
    const d = new Date(dateString), n = new Date(), diff = n - d;
    if (diff < 86400000 && d.getDate() === n.getDate()) return `Aujourd'hui à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const y = new Date(n); y.setDate(y.getDate() - 1);
    if (d.getDate() === y.getDate()) return `Hier à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function formatFileSize(b) { if (b === 0) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k)); return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i]; }
function escapeHtml(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function debounce(fn, delay) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; }

function playAudio(audioId, url) {
    const c = document.getElementById(`audio-${audioId}`);
    if (!c) return;
    const btn = c.querySelector('.audio-play-btn'), dur = c.querySelector('.audio-duration'), bars = c.querySelectorAll('.audio-waveform-bar');
    let a = c.audioElement;
    if (!a) {
        a = new Audio(url); c.audioElement = a;
        a.addEventListener('timeupdate', () => {
            const p = a.currentTime / a.duration, idx = Math.floor(p * bars.length);
            bars.forEach((b, i) => {
                b.classList.toggle('played', i <= idx);
                // Animate current bar
                if (i === idx) {
                    b.classList.add('current');
                } else {
                    b.classList.remove('current');
                }
            });
            const r = Math.floor(a.duration - a.currentTime);
            dur.textContent = `${Math.floor(r / 60)}:${(r % 60).toString().padStart(2, '0')}`;
        });
        a.addEventListener('ended', () => {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
            bars.forEach(b => { b.classList.remove('played', 'current'); });
            c.classList.remove('playing');
            dur.textContent = `${Math.floor(a.duration / 60)}:${Math.floor(a.duration % 60).toString().padStart(2, '0')}`;
        });
        a.addEventListener('loadedmetadata', () => { dur.textContent = `${Math.floor(a.duration / 60)}:${Math.floor(a.duration % 60).toString().padStart(2, '0')}`; });
    }
    if (a.paused) {
        a.play();
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        c.classList.add('playing');
    } else {
        a.pause();
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
        c.classList.remove('playing');
    }
}

// Global functions
window.viewImage = viewImage;
window.selectConversation = selectConversation;
window.startConversation = startConversation;
window.playAudio = playAudio;
window.showContextMenu = showContextMenu;
window.startReply = startReply;
window.openForwardModal = openForwardModal;
window.forwardMessage = forwardMessage;
window.scrollToMessage = scrollToMessage;
window.closeMessageSearch = closeMessageSearch;
window.toggleGroupMember = toggleGroupMember;
window.acceptFriendRequest = acceptFriendRequest;
window.rejectFriendRequest = rejectFriendRequest;
window.unblockUser = unblockUser;
window.startConversationWithFriend = startConversationWithFriend;
window.insertMention = insertMention;
