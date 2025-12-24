const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'discord.db'));

// Disable foreign keys for migration
db.pragma('foreign_keys = OFF');

// Helper to check if column exists
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

// Helper to check if table exists
function tableExists(name) {
  const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!result;
}

// Create base tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    status TEXT DEFAULT 'offline',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT,
    type TEXT DEFAULT 'text',
    file_url TEXT DEFAULT NULL,
    file_name TEXT DEFAULT NULL,
    file_size INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS friends (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS user_blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    blocked_user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, blocked_user_id)
  );

  CREATE TABLE IF NOT EXISTS message_requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friendship_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    uses INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
  );

  -- ==================== SERVERS ====================
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT NULL,
    banner TEXT DEFAULT NULL,
    owner_id TEXT NOT NULL,
    description TEXT DEFAULT NULL,
    invite_code TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname TEXT DEFAULT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, user_id)
  );

  -- ==================== CHANNELS ====================
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    category_id TEXT DEFAULT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    topic TEXT DEFAULT NULL,
    position INTEGER DEFAULT 0,
    is_private INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_categories (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== ROLES & PERMISSIONS ====================
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#99AAB5',
    position INTEGER DEFAULT 0,
    permissions TEXT DEFAULT '{}',
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS member_roles (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id, role_id)
  );

  -- ==================== SERVER MESSAGES ====================
  CREATE TABLE IF NOT EXISTS server_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT,
    type TEXT DEFAULT 'text',
    file_url TEXT DEFAULT NULL,
    file_name TEXT DEFAULT NULL,
    file_size INTEGER DEFAULT NULL,
    reply_to_id TEXT DEFAULT NULL,
    mentions TEXT DEFAULT NULL,
    reactions TEXT DEFAULT '{}',
    edited_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== VOICE CHANNELS ====================
  CREATE TABLE IF NOT EXISTS voice_states (
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    is_muted INTEGER DEFAULT 0,
    is_deafened INTEGER DEFAULT 0,
    is_video_on INTEGER DEFAULT 0,
    is_screen_sharing INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel_id)
  );

  -- ==================== SERVER INVITES ====================
  CREATE TABLE IF NOT EXISTS server_invites (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    channel_id TEXT,
    creator_id TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    uses INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add new columns to users table
const userColumns = [
  ['banner', 'TEXT DEFAULT NULL'],
  ['bio', 'TEXT DEFAULT NULL'],
  ['custom_status', 'TEXT DEFAULT NULL'],
  ['custom_status_emoji', 'TEXT DEFAULT NULL'],
  ['social_links', 'TEXT DEFAULT NULL'],
  ['presence', "TEXT DEFAULT 'online'"]
];

for (const [col, type] of userColumns) {
  if (!columnExists('users', col)) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`); } catch (e) { /* ignore */ }
  }
}

// Add new columns to conversations table
const convColumns = [
  ['type', "TEXT DEFAULT 'dm'"],
  ['name', 'TEXT DEFAULT NULL'],
  ['icon', 'TEXT DEFAULT NULL'],
  ['owner_id', 'TEXT DEFAULT NULL']
];

for (const [col, type] of convColumns) {
  if (!columnExists('conversations', col)) {
    try { db.exec(`ALTER TABLE conversations ADD COLUMN ${col} ${type}`); } catch (e) { /* ignore */ }
  }
}

// Add new columns to conversation_participants table
if (!columnExists('conversation_participants', 'nickname')) {
  try { db.exec(`ALTER TABLE conversation_participants ADD COLUMN nickname TEXT DEFAULT NULL`); } catch (e) { /* ignore */ }
}

// Add new columns to messages table
const msgColumns = [
  ['reply_to_id', 'TEXT DEFAULT NULL'],
  ['forwarded_from', 'TEXT DEFAULT NULL'],
  ['mentions', 'TEXT DEFAULT NULL'],
  ['edited_at', 'DATETIME DEFAULT NULL']
];

for (const [col, type] of msgColumns) {
  if (!columnExists('messages', col)) {
    try { db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${type}`); } catch (e) { /* ignore */ }
  }
}

// Create indexes (ONLY if they don't exist)
const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)',
  'CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id)',
  'CREATE INDEX IF NOT EXISTS idx_blocks_user ON user_blocks(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_message_requests ON message_requests(to_user_id)',
  // Server indexes
  'CREATE INDEX IF NOT EXISTS idx_server_members ON server_members(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id)',
  'CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_member_roles_server ON member_roles(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_server_messages_channel ON server_messages(channel_id)',
  'CREATE INDEX IF NOT EXISTS idx_server_messages_sender ON server_messages(sender_id)',
  'CREATE INDEX IF NOT EXISTS idx_voice_states_channel ON voice_states(channel_id)',
  'CREATE INDEX IF NOT EXISTS idx_server_invites ON server_invites(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_server_invites_code ON server_invites(code)'
];

for (const idx of indexes) {
  try { db.exec(idx); } catch (e) { /* ignore */ }
}

// Create index on reply_to_id only if the column exists
if (columnExists('messages', 'reply_to_id')) {
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id)'); } catch (e) { /* ignore */ }
}

// Re-enable foreign keys
db.pragma('foreign_keys = ON');

module.exports = db;
