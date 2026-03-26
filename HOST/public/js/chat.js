const API_URL = window.location.origin;
let socket = null;
let currentUser = null;
let currentContact = null;
let allUsers = [];
let activeUsers = [];
let searchTimeout = null;

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = {
        id: localStorage.getItem('userId'),
        username: localStorage.getItem('username')
    };
    
    if (!currentUser.id) {
        window.location.href = '/login.html';
        return;
    }
    
    // Отображаем текущего пользователя
    document.getElementById('currentUserName').textContent = currentUser.username;
    document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
    
    // Подключаем WebSocket
    connectSocket();
    
    // Загружаем контакты
    await loadContacts('');
    
    // Настройка обработчиков
    setupEventListeners();
});

function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('WebSocket подключен');
        socket.emit('auth', currentUser.id);
    });
    
    socket.on('active_users', (users) => {
        activeUsers = users;
        updateContactsStatus();
        updateCurrentContactStatus();
    });
    
    socket.on('new_message', (message) => {
        if (currentContact && message.from_user_id === currentContact.id) {
            appendMessage(message, false);
            markMessagesAsRead();
        }
        // Обновляем список контактов (для непрочитанных)
        loadContacts(document.getElementById('searchInput').value);
    });
    
    socket.on('message_sent', (message) => {
        if (currentContact && message.to_user_id === currentContact.id) {
            appendMessage(message, true);
        }
    });
    
    socket.on('user_typing', (data) => {
        if (currentContact && data.from_user_id === currentContact.id) {
            const indicator = document.getElementById('typingIndicator');
            if (data.is_typing) {
                indicator.textContent = `${currentContact.username} печатает...`;
            } else {
                indicator.textContent = '';
            }
        }
    });
}

async function loadContacts(searchQuery = '') {
    try {
        let url = `${API_URL}/api/users/search?exclude=${currentUser.id}`;
        if (searchQuery) {
            url += `&q=${encodeURIComponent(searchQuery)}`;
        }
        
        const response = await fetch(url);
        allUsers = await response.json();
        renderContactsList();
    } catch (err) {
        console.error('Ошибка загрузки контактов:', err);
    }
}

function renderContactsList() {
    const container = document.getElementById('contactsList');
    
    if (allUsers.length === 0) {
        container.innerHTML = '<div class="loading">👤 Нет пользователей<br><small>Пригласите родственников!</small></div>';
        return;
    }
    
    container.innerHTML = allUsers.map(user => {
        const isActive = currentContact && currentContact.id === user.id;
        const isOnline = activeUsers.includes(user.id);
        
        return `
            <div class="contact-item ${isActive ? 'active' : ''}" data-user-id="${user.id}" data-username="${user.username}">
                <div class="contact-avatar">${user.username.charAt(0).toUpperCase()}</div>
                <div class="contact-info">
                    <div class="contact-name">${escapeHtml(user.username)}</div>
                    <div class="contact-status">
                        <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                        <span>${isOnline ? 'в сети' : 'не в сети'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Добавляем обработчики
    document.querySelectorAll('.contact-item').forEach(el => {
        el.addEventListener('click', () => {
            const userId = parseInt(el.dataset.userId);
            const username = el.dataset.username;
            selectContact({ id: userId, username });
        });
    });
}

function updateContactsStatus() {
    document.querySelectorAll('.contact-item').forEach(el => {
        const userId = parseInt(el.dataset.userId);
        const isOnline = activeUsers.includes(userId);
        const statusSpan = el.querySelector('.contact-status span:last-child');
        const dotSpan = el.querySelector('.status-dot');
        
        if (statusSpan) {
            statusSpan.textContent = isOnline ? 'в сети' : 'не в сети';
        }
        if (dotSpan) {
            dotSpan.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        }
    });
}

function updateCurrentContactStatus() {
    if (currentContact) {
        const isOnline = activeUsers.includes(currentContact.id);
        const statusText = document.getElementById('statusText');
        const dotSpan = document.querySelector('#chatContactStatus .status-dot');
        
        if (statusText) statusText.textContent = isOnline ? 'в сети' : 'не в сети';
        if (dotSpan) dotSpan.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    }
}

function selectContact(contact) {
    currentContact = contact;
    
    // Обновляем UI чата
    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatActive').style.display = 'flex';
    document.getElementById('chatContactName').textContent = contact.username;
    document.getElementById('chatContactAvatar').textContent = contact.username.charAt(0).toUpperCase();
    updateCurrentContactStatus();
    
    // Подсвечиваем активный контакт
    document.querySelectorAll('.contact-item').forEach(el => {
        el.classList.remove('active');
        if (parseInt(el.dataset.userId) === contact.id) {
            el.classList.add('active');
        }
    });
    
    // Загружаем историю
    loadMessages();
    
    // Фокус на поле ввода
    document.getElementById('messageInput').focus();
}

async function loadMessages() {
    if (!currentContact) return;
    
    try {
        const response = await fetch(`${API_URL}/api/messages/${currentUser.id}/${currentContact.id}`);
        const messages = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        messages.forEach(msg => {
            const isOutgoing = msg.from_user_id === currentUser.id;
            appendMessageToContainer(msg, isOutgoing);
        });
        
        scrollToBottom();
        markMessagesAsRead();
    } catch (err) {
        console.error('Ошибка загрузки сообщений:', err);
    }
}

function appendMessage(message, isOutgoing) {
    const container = document.getElementById('messagesContainer');
    const messageElement = createMessageElement(message, isOutgoing);
    container.appendChild(messageElement);
    scrollToBottom();
}

function appendMessageToContainer(message, isOutgoing) {
    const container = document.getElementById('messagesContainer');
    const messageElement = createMessageElement(message, isOutgoing);
    container.appendChild(messageElement);
}

function createMessageElement(message, isOutgoing) {
    const div = document.createElement('div');
    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    div.innerHTML = `
        <div class="message-bubble">${escapeHtml(message.message)}</div>
        <div class="message-time">${time}</div>
    `;
    
    return div;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || !currentContact) return;
    
    input.value = '';
    input.style.height = 'auto';
    
    socket.emit('private_message', {
        from_user_id: currentUser.id,
        to_user_id: currentContact.id,
        message: message
    });
}

async function markMessagesAsRead() {
    if (!currentContact) return;
    
    try {
        await fetch(`${API_URL}/api/messages/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                contactId: currentContact.id
            })
        });
    } catch (err) {
        console.error('Ошибка обновления статуса:', err);
    }
}

let typingTimeout;
function onTyping() {
    if (!currentContact) return;
    
    socket.emit('typing', {
        from_user_id: currentUser.id,
        to_user_id: currentContact.id,
        is_typing: true
    });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', {
            from_user_id: currentUser.id,
            to_user_id: currentContact.id,
            is_typing: false
        });
    }, 1000);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function setupEventListeners() {
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const logoutBtn = document.getElementById('logoutBtn');
    const searchInput = document.getElementById('searchInput');
    
    sendBtn.addEventListener('click', sendMessage);
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    messageInput.addEventListener('input', () => {
        onTyping();
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
    });
    
    logoutBtn.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '/login.html';
    });
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadContacts(e.target.value);
        }, 300);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}