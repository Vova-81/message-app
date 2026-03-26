const API_URL = window.location.origin;

document.getElementById('loginBtn').addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    
    if (!username) {
        alert('Введите имя пользователя');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        
        if (response.status === 401 || data.error) {
            alert(data.error || 'Пользователь не найден');
        } else {
            localStorage.setItem('userId', data.id);
            localStorage.setItem('username', data.username);
            window.location.href = '/chat.html';
        }
    } catch (err) {
        console.error('Ошибка:', err);
        alert('Не удалось подключиться к серверу');
    }
});

document.getElementById('username').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('loginBtn').click();
    }
});