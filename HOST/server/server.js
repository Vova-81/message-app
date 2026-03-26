const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Подключение к PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Создание таблиц
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица users готова');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица messages готова');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_users 
      ON messages(from_user_id, to_user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created 
      ON messages(created_at)
    `);
    console.log('✅ Индексы созданы');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
  }
}

// Проверка подключения
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  } else {
    console.log('✅ Подключено к PostgreSQL');
    release();
    await initDatabase();
  }
});

// ============ API ============

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username } = req.body;
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Имя пользователя обязательно' });
  }
  
  try {
    const existingUser = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
    }
    
    const result = await pool.query(
      'INSERT INTO users (username) VALUES ($1) RETURNING id, username',
      [username]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  const { username } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка входа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Поиск пользователей
app.get('/api/users/search', async (req, res) => {
  const { q, exclude } = req.query;
  
  try {
    let query = 'SELECT id, username FROM users';
    let params = [];
    
    if (q && q.trim() !== '') {
      query += ' WHERE username ILIKE $1';
      params.push(`%${q}%`);
      
      if (exclude) {
        query += ' AND id != $2';
        params.push(exclude);
      }
    } else if (exclude) {
      query += ' WHERE id != $1';
      params.push(exclude);
    }
    
    query += ' ORDER BY username LIMIT 20';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка поиска:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить всех пользователей
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username FROM users ORDER BY username'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить историю сообщений
app.get('/api/messages/:userId/:contactId', async (req, res) => {
  const { userId, contactId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT * FROM messages 
       WHERE (from_user_id = $1 AND to_user_id = $2)
          OR (from_user_id = $2 AND to_user_id = $1)
       ORDER BY created_at ASC
       LIMIT 100`,
      [userId, contactId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка получения сообщений:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Пометить сообщения как прочитанные
app.post('/api/messages/read', async (req, res) => {
  const { userId, contactId } = req.body;
  
  try {
    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE from_user_id = $1 AND to_user_id = $2 AND is_read = false`,
      [contactId, userId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка обновления статуса:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ WebSocket ============

const activeUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Новое подключение:', socket.id);
  
  socket.on('auth', (userId) => {
    activeUsers.set(userId, socket.id);
    userSockets.set(socket.id, userId);
    socket.userId = userId;
    
    console.log(`👤 Пользователь ${userId} в сети`);
    
    const activeUserIds = Array.from(activeUsers.keys());
    io.emit('active_users', activeUserIds);
  });
  
  socket.on('private_message', async (data) => {
    const { from_user_id, to_user_id, message } = data;
    
    try {
      const result = await pool.query(
        `INSERT INTO messages (from_user_id, to_user_id, message, is_read)
         VALUES ($1, $2, $3, false)
         RETURNING id, created_at`,
        [from_user_id, to_user_id, message]
      );
      
      const savedMessage = {
        id: result.rows[0].id,
        from_user_id,
        to_user_id,
        message,
        created_at: result.rows[0].created_at,
        is_read: false
      };
      
      socket.emit('message_sent', savedMessage);
      
      const recipientSocketId = activeUsers.get(to_user_id);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('new_message', savedMessage);
      }
    } catch (err) {
      console.error('Ошибка отправки:', err);
      socket.emit('error', { error: 'Не удалось отправить сообщение' });
    }
  });
  
  socket.on('typing', (data) => {
    const { from_user_id, to_user_id, is_typing } = data;
    const recipientSocketId = activeUsers.get(to_user_id);
    
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user_typing', {
        from_user_id,
        is_typing
      });
    }
  });
  
  socket.on('disconnect', () => {
    const userId = userSockets.get(socket.id);
    if (userId) {
      activeUsers.delete(userId);
      userSockets.delete(socket.id);
      console.log(`👋 Пользователь ${userId} отключился`);
      
      const activeUserIds = Array.from(activeUsers.keys());
      io.emit('active_users', activeUserIds);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});