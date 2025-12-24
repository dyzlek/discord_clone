// public/js/modules/servers.js - Server management module
const ServersModule = (function () {
    let servers = [];
    let currentServer = null;
    let currentChannel = null;

    // API helpers
    async function apiRequest(url, options = {}) {
        const token = localStorage.getItem('token');
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...options.headers
            }
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    }

    // Load user's servers
    async function loadServers() {
        try {
            servers = await apiRequest('/api/servers');
            renderServersList();
            return servers;
        } catch (error) {
            console.error('Failed to load servers:', error);
            return [];
        }
    }

    // Render servers in sidebar
    function renderServersList() {
        const container = document.getElementById('servers-list');
        if (!container) return;

        container.innerHTML = servers.map(server => `
            <div class="server-icon ${currentServer?.id === server.id ? 'active' : ''}" 
                 data-server-id="${server.id}" 
                 data-tooltip="${server.name}"
                 onclick="ServersModule.selectServer('${server.id}')">
                ${server.icon
                ? `<img src="${server.icon}" alt="${server.name}">`
                : `<span>${server.name.charAt(0).toUpperCase()}</span>`
            }
                ${server.unread_count ? `<span class="server-badge">${server.unread_count}</span>` : ''}
            </div>
        `).join('');
    }

    // Select a server
    async function selectServer(serverId) {
        try {
            currentServer = await apiRequest(`/api/servers/${serverId}`);

            // Show server sidebar, hide conversations sidebar
            document.getElementById('conversations-sidebar')?.classList.add('hidden');
            document.getElementById('server-sidebar')?.classList.remove('hidden');

            // Show server view, hide DM view  
            document.getElementById('dm-view')?.classList.add('hidden');
            document.getElementById('server-view')?.classList.remove('hidden');
            document.getElementById('friends-panel')?.classList.add('hidden');

            // Update server name in sidebar header
            document.getElementById('server-name').textContent = currentServer.name;

            // Update user info in server sidebar
            if (typeof currentUser !== 'undefined') {
                document.getElementById('current-username-server').textContent = currentUser.username;
                const avatarEl = document.getElementById('current-user-avatar-server');
                if (avatarEl && currentUser.avatar) {
                    avatarEl.innerHTML = `<img src="${currentUser.avatar}" alt=""><span class="status-indicator ${currentUser.presence || 'online'}"></span>`;
                }
            }

            // Render channels and members
            renderServerView();

            // Select first text channel by default
            const firstTextChannel = currentServer.channels?.find(c => c.type === 'text');
            if (firstTextChannel) {
                await selectChannel(firstTextChannel.id);
            }

            // Update server icons
            document.querySelectorAll('.server-icon').forEach(el => {
                el.classList.toggle('active', el.dataset.serverId === serverId);
            });
            document.getElementById('home-btn')?.classList.remove('active');

        } catch (error) {
            console.error('Failed to select server:', error);
            showToast('Erreur lors du chargement du serveur', 'error');
        }
    }

    // Render server view (channels, members)
    function renderServerView() {
        if (!currentServer) return;

        // Update server header
        const serverHeader = document.getElementById('server-header');
        if (serverHeader) {
            serverHeader.innerHTML = `
                <div class="server-header-content">
                    <h2>${currentServer.name}</h2>
                    <button class="icon-btn" onclick="ServersModule.showServerSettings()">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
            `;
        }

        // Render channels
        renderChannelsList();

        // Render members
        renderMembersList();
    }

    // Render channels list
    function renderChannelsList() {
        const container = document.getElementById('channels-list');
        if (!container || !currentServer) return;

        // Group channels by category
        const uncategorized = currentServer.channels.filter(c => !c.category_id);
        const categoriesMap = new Map();

        currentServer.categories.forEach(cat => {
            categoriesMap.set(cat.id, {
                ...cat,
                channels: currentServer.channels.filter(c => c.category_id === cat.id)
            });
        });

        let html = '';

        // Uncategorized channels first
        if (uncategorized.length > 0) {
            html += uncategorized.map(channel => renderChannel(channel)).join('');
        }

        // Then each category
        categoriesMap.forEach(category => {
            html += `
                <div class="channel-category">
                    <div class="category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                        <i class="fas fa-chevron-down"></i>
                        <span>${category.name.toUpperCase()}</span>
                        <button class="icon-btn small" onclick="event.stopPropagation(); ServersModule.showCreateChannel('${category.id}')">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="category-channels">
                        ${category.channels.map(channel => renderChannel(channel)).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // Render single channel
    function renderChannel(channel) {
        const isActive = currentChannel?.id === channel.id;
        const icon = channel.type === 'voice' ? 'fa-volume-up' :
            channel.type === 'video' ? 'fa-video' : 'fa-hashtag';

        return `
            <div class="channel-item ${isActive ? 'active' : ''} ${channel.type}" 
                 data-channel-id="${channel.id}"
                 onclick="ServersModule.selectChannel('${channel.id}')">
                <i class="fas ${icon}"></i>
                <span class="channel-name">${channel.name}</span>
                ${channel.type === 'voice' && channel.voice_participant_count > 0
                ? `<span class="voice-count">${channel.voice_participant_count}</span>`
                : ''}
            </div>
            ${channel.type === 'voice' || channel.type === 'video'
                ? renderVoiceParticipants(channel)
                : ''}
        `;
    }

    // Render voice participants in channel
    function renderVoiceParticipants(channel) {
        // This will be populated by voice module
        return `<div class="voice-participants" id="voice-participants-${channel.id}"></div>`;
    }

    // Render members list
    function renderMembersList() {
        const container = document.getElementById('members-list');
        if (!container || !currentServer) return;

        // Group members by role
        const owner = currentServer.members.find(m => m.id === currentServer.owner_id);
        const onlineMembers = currentServer.members.filter(m => m.status === 'online' && m.id !== owner?.id);
        const offlineMembers = currentServer.members.filter(m => m.status !== 'online' && m.id !== owner?.id);

        container.innerHTML = `
            ${owner ? `
                <div class="members-section">
                    <div class="section-header">PROPRIÉTAIRE — 1</div>
                    ${renderMember(owner, true)}
                </div>
            ` : ''}
            ${onlineMembers.length > 0 ? `
                <div class="members-section">
                    <div class="section-header">EN LIGNE — ${onlineMembers.length}</div>
                    ${onlineMembers.map(m => renderMember(m)).join('')}
                </div>
            ` : ''}
            ${offlineMembers.length > 0 ? `
                <div class="members-section">
                    <div class="section-header">HORS LIGNE — ${offlineMembers.length}</div>
                    ${offlineMembers.map(m => renderMember(m)).join('')}
                </div>
            ` : ''}
        `;
    }

    // Render single member
    function renderMember(member, isOwner = false) {
        return `
            <div class="member-item" data-user-id="${member.id}">
                <div class="member-avatar">
                    <img src="${member.avatar || '/default-avatar.png'}" alt="${member.username}">
                    <span class="status-dot ${member.status || 'offline'}"></span>
                </div>
                <div class="member-info">
                    <span class="member-name" style="${isOwner ? 'color: #faa61a;' : ''}">${member.nickname || member.username}</span>
                    ${isOwner ? '<i class="fas fa-crown" style="color: #faa61a; font-size: 10px;"></i>' : ''}
                </div>
            </div>
        `;
    }

    // Select channel
    async function selectChannel(channelId) {
        const channel = currentServer?.channels.find(c => c.id === channelId);
        if (!channel) return;

        currentChannel = channel;

        // Update active state
        document.querySelectorAll('.channel-item').forEach(el => {
            el.classList.toggle('active', el.dataset.channelId === channelId);
        });

        if (channel.type === 'text') {
            await loadChannelMessages(channelId);
            showTextChannelView();
        } else if (channel.type === 'voice' || channel.type === 'video') {
            // Show join prompt or auto-join
            VoiceModule?.showJoinVoicePrompt(channel);
        }
    }

    // Load channel messages
    async function loadChannelMessages(channelId) {
        try {
            const messages = await apiRequest(`/api/channels/${channelId}/messages`);
            renderChannelMessages(messages);
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    }

    // Render channel messages
    function renderChannelMessages(messages) {
        const container = document.getElementById('channel-messages');
        if (!container) return;

        container.innerHTML = messages.map(msg => `
            <div class="message" data-message-id="${msg.id}">
                <img src="${msg.sender_avatar || '/default-avatar.png'}" class="message-avatar" alt="">
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author">${msg.sender_username}</span>
                        <span class="message-time">${formatTime(msg.created_at)}</span>
                    </div>
                    <div class="message-text">${formatContent(msg.content)}</div>
                    ${msg.file_url ? renderAttachment(msg) : ''}
                </div>
            </div>
        `).join('');

        container.scrollTop = container.scrollHeight;
    }

    // Helper functions
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'À l\'instant';
        if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`;
        if (date.toDateString() === now.toDateString()) {
            return `Aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    function formatContent(content) {
        if (!content) return '';
        return content
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    function renderAttachment(msg) {
        if (msg.type === 'image') {
            return `<img src="${msg.file_url}" class="message-image" onclick="openImageViewer('${msg.file_url}')">`;
        }
        if (msg.type === 'video') {
            return `<video src="${msg.file_url}" controls class="message-video"></video>`;
        }
        return `<a href="${msg.file_url}" class="file-attachment" download="${msg.file_name}">
            <i class="fas fa-file"></i> ${msg.file_name}
        </a>`;
    }

    function showTextChannelView() {
        document.getElementById('channel-text-view')?.classList.remove('hidden');
        document.getElementById('channel-voice-view')?.classList.add('hidden');
    }

    // Send message to channel
    async function sendChannelMessage(content, files = []) {
        if (!currentChannel || !content.trim()) return;

        try {
            // Upload files first if any
            let fileData = null;
            if (files.length > 0) {
                const formData = new FormData();
                formData.append('file', files[0]);
                const token = localStorage.getItem('token');
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                fileData = await uploadRes.json();
            }

            await apiRequest(`/api/channels/${currentChannel.id}/messages`, {
                method: 'POST',
                body: JSON.stringify({
                    content: content.trim(),
                    type: fileData?.type || 'text',
                    fileUrl: fileData?.url,
                    fileName: fileData?.name,
                    fileSize: fileData?.size
                })
            });

            // Clear input
            const input = document.getElementById('channel-message-input');
            if (input) input.value = '';

        } catch (error) {
            console.error('Failed to send message:', error);
            showToast('Erreur lors de l\'envoi du message', 'error');
        }
    }

    // Create server
    async function createServer(name, icon = null) {
        try {
            const server = await apiRequest('/api/servers', {
                method: 'POST',
                body: JSON.stringify({ name, icon })
            });
            servers.push(server);
            renderServersList();
            await selectServer(server.id);
            showToast('Serveur créé avec succès!', 'success');
            return server;
        } catch (error) {
            console.error('Failed to create server:', error);
            showToast(error.message, 'error');
        }
    }

    // Create channel
    async function createChannel(name, type = 'text', categoryId = null) {
        if (!currentServer) return;

        try {
            const channel = await apiRequest('/api/channels', {
                method: 'POST',
                body: JSON.stringify({
                    serverId: currentServer.id,
                    name,
                    type,
                    categoryId
                })
            });
            currentServer.channels.push(channel);
            renderChannelsList();
            showToast('Salon créé!', 'success');
            return channel;
        } catch (error) {
            console.error('Failed to create channel:', error);
            showToast(error.message, 'error');
        }
    }

    // Join server via invite
    async function joinServer(inviteCode) {
        try {
            const server = await apiRequest(`/api/servers/join/${inviteCode}`, {
                method: 'POST'
            });
            servers.push(server);
            renderServersList();
            await selectServer(server.id);
            showToast(`Vous avez rejoint ${server.name}!`, 'success');
            return server;
        } catch (error) {
            console.error('Failed to join server:', error);
            showToast(error.message, 'error');
        }
    }

    // Generate invite
    async function createInvite(maxUses = null, expiresIn = null) {
        if (!currentServer) return;

        try {
            const invite = await apiRequest(`/api/servers/${currentServer.id}/invites`, {
                method: 'POST',
                body: JSON.stringify({ maxUses, expiresIn })
            });
            return invite.code;
        } catch (error) {
            console.error('Failed to create invite:', error);
            showToast(error.message, 'error');
        }
    }

    // Leave server
    async function leaveServer(serverId) {
        try {
            await apiRequest(`/api/servers/${serverId}/leave`, { method: 'POST' });
            servers = servers.filter(s => s.id !== serverId);
            renderServersList();

            if (currentServer?.id === serverId) {
                currentServer = null;
                currentChannel = null;
                document.getElementById('server-view')?.classList.add('hidden');
            }

            showToast('Vous avez quitté le serveur', 'info');
        } catch (error) {
            console.error('Failed to leave server:', error);
            showToast(error.message, 'error');
        }
    }

    // Socket event handlers
    function handleServerMessage(data) {
        if (currentChannel?.id === data.channelId) {
            const container = document.getElementById('channel-messages');
            if (container) {
                container.innerHTML += `
                    <div class="message" data-message-id="${data.message.id}">
                        <img src="${data.message.sender_avatar || '/default-avatar.png'}" class="message-avatar" alt="">
                        <div class="message-content">
                            <div class="message-header">
                                <span class="message-author">${data.message.sender_username}</span>
                                <span class="message-time">${formatTime(data.message.created_at)}</span>
                            </div>
                            <div class="message-text">${formatContent(data.message.content)}</div>
                            ${data.message.file_url ? renderAttachment(data.message) : ''}
                        </div>
                    </div>
                `;
                container.scrollTop = container.scrollHeight;
            }
        }
    }

    function handleChannelCreated(data) {
        if (currentServer?.id === data.serverId) {
            currentServer.channels.push(data.channel);
            renderChannelsList();
        }
    }

    function handleChannelDeleted(data) {
        if (currentServer?.id === data.serverId) {
            currentServer.channels = currentServer.channels.filter(c => c.id !== data.channelId);
            renderChannelsList();
            if (currentChannel?.id === data.channelId) {
                currentChannel = null;
            }
        }
    }

    function handleMemberJoined(data) {
        if (currentServer?.id === data.serverId) {
            currentServer.members.push(data.user);
            renderMembersList();
        }
    }

    function handleMemberLeft(data) {
        if (currentServer?.id === data.serverId) {
            currentServer.members = currentServer.members.filter(m => m.id !== data.userId);
            renderMembersList();
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

    // Modal helpers
    function showCreateServerModal() {
        const modal = document.getElementById('create-server-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function showJoinServerModal() {
        const modal = document.getElementById('join-server-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function showCreateChannel(categoryId = null) {
        const modal = document.getElementById('create-channel-modal');
        if (modal) {
            modal.dataset.categoryId = categoryId || '';
            modal.classList.remove('hidden');
        }
    }

    function showServerSettings() {
        const modal = document.getElementById('server-settings-modal');
        if (modal) modal.classList.remove('hidden');
    }

    // Public API
    return {
        loadServers,
        selectServer,
        selectChannel,
        sendChannelMessage,
        createServer,
        createChannel,
        joinServer,
        createInvite,
        leaveServer,
        handleServerMessage,
        handleChannelCreated,
        handleChannelDeleted,
        handleMemberJoined,
        handleMemberLeft,
        showCreateServerModal,
        showJoinServerModal,
        showCreateChannel,
        showServerSettings,
        getCurrentServer: () => currentServer,
        getCurrentChannel: () => currentChannel,
        getServers: () => servers
    };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServersModule;
}
