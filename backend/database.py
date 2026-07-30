import sqlite3
from app.core.config import settings

DB_PATH = settings.data_dir / "database.db"

def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create settings table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            auto_reply_enabled INTEGER DEFAULT 0,
            auto_reply_template TEXT DEFAULT 'Cảm ơn bạn đã quan tâm!'
        )
    """)
    
    # Create comments table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            comment_id TEXT PRIMARY KEY,
            post_id TEXT,
            author TEXT,
            comment_text TEXT,
            is_replied INTEGER DEFAULT 0,
            reply_text TEXT DEFAULT ''
        )
    """)
    
    # Check settings columns (alter if necessary)
    cursor.execute("PRAGMA table_info(settings)")
    columns = [row[1] for row in cursor.fetchall()]
    if "auto_reply_enabled" not in columns:
        try:
            cursor.execute("ALTER TABLE settings ADD COLUMN auto_reply_enabled INTEGER DEFAULT 0")
        except Exception:
            pass
    if "auto_reply_template" not in columns:
        try:
            cursor.execute("ALTER TABLE settings ADD COLUMN auto_reply_template TEXT DEFAULT 'Cảm ơn bạn đã quan tâm!'")
        except Exception:
            pass

    # Check comments columns (alter if necessary)
    cursor.execute("PRAGMA table_info(comments)")
    columns = [row[1] for row in cursor.fetchall()]
    if "is_replied" not in columns:
        try:
            cursor.execute("ALTER TABLE comments ADD COLUMN is_replied INTEGER DEFAULT 0")
        except Exception:
            pass
    if "reply_text" not in columns:
        try:
            cursor.execute("ALTER TABLE comments ADD COLUMN reply_text TEXT DEFAULT ''")
        except Exception:
            pass
            
    # Ensure at least one settings row exists
    cursor.execute("SELECT COUNT(*) FROM settings")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO settings (auto_reply_enabled, auto_reply_template) VALUES (0, 'Cảm ơn bạn đã quan tâm!')")
        
    conn.commit()
    conn.close()

# Run initialization when module loaded
init_db()

def get_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT auto_reply_enabled, auto_reply_template FROM settings LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "auto_reply_enabled": int(row["auto_reply_enabled"]),
            "auto_reply_template": row["auto_reply_template"]
        }
    return {
        "auto_reply_enabled": 0,
        "auto_reply_template": "Cảm ơn bạn đã quan tâm!"
    }

def save_settings(auto_reply_enabled: int, auto_reply_template: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Update first settings row
    cursor.execute("""
        UPDATE settings 
        SET auto_reply_enabled = ?, auto_reply_template = ?
        WHERE id = (SELECT id FROM settings LIMIT 1)
    """, (auto_reply_enabled, auto_reply_template))
    conn.commit()
    conn.close()

def save_comment(comment_id: str, post_id: str, author: str, comment_text: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if comment exists
    cursor.execute("SELECT is_replied, reply_text FROM comments WHERE comment_id = ?", (comment_id,))
    row = cursor.fetchone()
    
    if row:
        # Exists: update basic details but preserve is_replied and reply_text
        cursor.execute("""
            UPDATE comments
            SET post_id = ?, author = ?, comment_text = ?
            WHERE comment_id = ?
        """, (post_id, author, comment_text, comment_id))
    else:
        # New comment: insert with default replied state
        cursor.execute("""
            INSERT INTO comments (comment_id, post_id, author, comment_text, is_replied, reply_text)
            VALUES (?, ?, ?, ?, 0, '')
        """, (comment_id, post_id, author, comment_text))
        
    conn.commit()
    conn.close()

def get_comment(comment_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM comments WHERE comment_id = ?", (comment_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def mark_comment_replied(comment_id: str, reply_text: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE comments
        SET is_replied = 1, reply_text = ?
        WHERE comment_id = ?
    """, (reply_text, comment_id))
    conn.commit()
    conn.close()
