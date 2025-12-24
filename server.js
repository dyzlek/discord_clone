// Discord Clone - Main Server (Modular Structure)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// Database
const db = require('./database');

// Auth middleware
const { verifyToken } = require('./auth');
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const token = authHeader.split(' ')[1];
    const user = verifyToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Token invalide' });
    }
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!req.user) {
        return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    next();
};

// Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// User sockets map
const userSockets = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== AUTH ROUTES ====================
const { register, login } = require('./auth');

app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = db.prepare(`
    SELECT id, username, email, avatar, banner, bio, custom_status, custom_status_emoji, 
           social_links, status, presence, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

    user.social_links = user.social_links ? JSON.parse(user.social_links) : {};
    res.json(user);
});

// ==================== MODULAR ROUTES ====================
const usersRoutes = require('./routes/users');
const friendsRoutes = require('./routes/friends');
const blocksRoutes = require('./routes/blocks');
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes = require('./routes/messages');
const serversRoutes = require('./routes/servers');
const channelsRoutes = require('./routes/channels');
const rolesRoutes = require('./routes/roles');

app.use('/api/users', usersRoutes(db, authMiddleware));
app.use('/api/friends', friendsRoutes(db, authMiddleware, io, userSockets));
app.use('/api/blocks', blocksRoutes(db, authMiddleware));
app.use('/api/conversations', conversationsRoutes(db, authMiddleware, io, userSockets));
app.use('/api/messages', messagesRoutes(db, authMiddleware, io, userSockets));
app.use('/api/servers', serversRoutes(db, authMiddleware, io, userSockets));
app.use('/api/channels', channelsRoutes(db, authMiddleware, io, userSockets));
app.use('/api/roles', rolesRoutes(db, authMiddleware, io, userSockets));

// ==================== FILE UPLOAD ====================
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier' });
    }

    const mime = req.file.mimetype;
    let type = 'file';
    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else if (mime.startsWith('audio/')) type = 'audio';

    res.json({
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        size: req.file.size,
        type
    });
});

// ==================== SOCKET.IO ====================
const socketHandlers = require('./socket/handlers');
socketHandlers(io, db, userSockets);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║     Discord Clone - Server Running       ║
  ║                                          ║
  ║   http://localhost:${PORT}                  ║
  ╚══════════════════════════════════════════╝
  `);
});
