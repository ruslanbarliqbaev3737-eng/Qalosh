const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Инициализация БД (SQLite)
let db;
(async () => {
    db = await open({
        filename: './qar.db',
        driver: sqlite3.Database
    });

    // Создание таблиц
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            city TEXT,
            address TEXT,
            balance INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            rentCount INTEGER DEFAULT 0,
            failCount INTEGER DEFAULT 0,
            blocked INTEGER DEFAULT 0,
            verified INTEGER DEFAULT 0,
            isAdmin INTEGER DEFAULT 0,
            passportPhoto TEXT,
            selfiePhoto TEXT,
            lat REAL,
            lng REAL
        );

        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT,
            priceDay INTEGER,
            price2Day INTEGER,
            priceMonth INTEGER,
            desc TEXT,
            image TEXT,
            ownerId INTEGER,
            ownerName TEXT,
            city TEXT,
            address TEXT,
            status TEXT DEFAULT 'available',
            createdAt TEXT,
            rating INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS rentals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            itemId INTEGER,
            itemName TEXT,
            renterId INTEGER,
            ownerId INTEGER,
            startDate TEXT,
            endDate TEXT,
            price INTEGER,
            fee INTEGER,
            status TEXT DEFAULT 'active',
            createdAt TEXT
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            type TEXT,
            title TEXT,
            amount INTEGER,
            date TEXT
        );
    `);

    // Создаём админа, если нет
    const admin = await db.get(`SELECT id FROM users WHERE isAdmin = 1`);
    if (!admin) {
        await db.run(`
            INSERT INTO users (name, phone, password, city, address, balance, verified, isAdmin)
            VALUES ('Admin', 'admin', 'admin123', 'Nokis', 'Admin', 0, 1, 1)
        `);
    }

    // Тестовый пользователь
    const testUser = await db.get(`SELECT id FROM users WHERE phone = '+998 90 123 45 67'`);
    if (!testUser) {
        await db.run(`
            INSERT INTO users (name, phone, password, city, address, balance, verified)
            VALUES ('Alibek Temirbekov', '+998 90 123 45 67', '123456', 'Nokis', 'Dosnazarov 15', 500000, 1)
        `);
    }

    console.log('✅ База данных готова');
})();

// ============ API ============

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { name, phone, password, city, address, passportPhoto, selfiePhoto, lat, lng } = req.body;
        const existing = await db.get(`SELECT id FROM users WHERE phone = ?`, [phone]);
        if (existing) return res.status(400).json({ error: 'Телефон уже занят' });

        await db.run(`
            INSERT INTO users (name, phone, password, city, address, passportPhoto, selfiePhoto, lat, lng)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [name, phone, password, city, address, passportPhoto || '', selfiePhoto || '', lat || 0, lng || 0]);

        const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Логин
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await db.get(`
            SELECT * FROM users WHERE phone = ? AND password = ? AND isAdmin = 0
        `, [phone, password]);
        if (!user) return res.status(401).json({ error: 'Неверные данные' });
        if (user.blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Админ-логин
app.post('/api/admin/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const admin = await db.get(`
            SELECT * FROM users WHERE phone = ? AND password = ? AND isAdmin = 1
        `, [phone, password]);
        if (!admin) return res.status(401).json({ error: 'Неверные данные' });
        res.json({ admin });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получить данные пользователя (по id)
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await db.get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получить все предметы (доступные)
app.get('/api/items', async (req, res) => {
    try {
        const { category, search } = req.query;
        let sql = `SELECT * FROM items WHERE status = 'available'`;
        const params = [];
        if (category && category !== 'all') {
            sql += ` AND category = ?`;
            params.push(category);
        }
        if (search) {
            sql += ` AND LOWER(name) LIKE '%' || ? || '%'`;
            params.push(search.toLowerCase());
        }
        const items = await db.all(sql, params);
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Добавить предмет
app.post('/api/items', async (req, res) => {
    try {
        const { name, category, priceDay, price2Day, priceMonth, desc, image, ownerId, ownerName, city, address } = req.body;
        const result = await db.run(`
            INSERT INTO items (name, category, priceDay, price2Day, priceMonth, desc, image, ownerId, ownerName, city, address, status, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
        `, [name, category, priceDay, price2Day, priceMonth, desc, image, ownerId, ownerName, city, address, new Date().toISOString()]);
        const item = await db.get(`SELECT * FROM items WHERE id = ?`, [result.lastID]);
        res.json({ item });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Удалить предмет
app.delete('/api/items/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM items WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получить предметы пользователя
app.get('/api/user/:userId/items', async (req, res) => {
    try {
        const items = await db.all(`SELECT * FROM items WHERE ownerId = ?`, [req.params.userId]);
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получить активные аренды пользователя
app.get('/api/user/:userId/rentals/active', async (req, res) => {
    try {
        const rentals = await db.all(`
            SELECT * FROM rentals
            WHERE status = 'active' AND (renterId = ? OR ownerId = ?)
        `, [req.params.userId, req.params.userId]);
        res.json({ rentals });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Создать аренду
app.post('/api/rentals', async (req, res) => {
    try {
        const { itemId, itemName, renterId, ownerId, startDate, endDate, price, fee } = req.body;
        const total = price + fee;

        // Проверка баланса арендатора
        const renter = await db.get(`SELECT balance FROM users WHERE id = ?`, [renterId]);
        if (!renter || renter.balance < total) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        // Проверка блокировки владельца
        const owner = await db.get(`SELECT blocked FROM users WHERE id = ?`, [ownerId]);
        if (owner && owner.blocked) {
            return res.status(403).json({ error: 'Владелец заблокирован' });
        }

        // Создаём аренду
        const result = await db.run(`
            INSERT INTO rentals (itemId, itemName, renterId, ownerId, startDate, endDate, price, fee, status, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `, [itemId, itemName, renterId, ownerId, startDate, endDate, price, fee, new Date().toISOString()]);

        // Списываем средства у арендатора
        await db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [total, renterId]);
        // Начисляем владельцу
        await db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [price, ownerId]);

        // Обновляем статус предмета
        await db.run(`UPDATE items SET status = 'rented' WHERE id = ?`, [itemId]);

        // Транзакции
        const now = new Date().toISOString();
        await db.run(`
            INSERT INTO transactions (userId, type, title, amount, date)
            VALUES (?, 'out', ?, ?, ?)
        `, [renterId, 'Аренда: ' + itemName, -price, now]);

        await db.run(`
            INSERT INTO transactions (userId, type, title, amount, date)
            VALUES (?, 'fee', 'Комиссия 5%', ?, ?)
        `, [renterId, -fee, now]);

        await db.run(`
            INSERT INTO transactions (userId, type, title, amount, date)
            VALUES (?, 'in', 'Аренда: ' + itemName, ?, ?)
        `, [ownerId, price, now]);

        const rental = await db.get(`SELECT * FROM rentals WHERE id = ?`, [result.lastID]);
        res.json({ rental });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Пополнить баланс
app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        await db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, userId]);
        await db.run(`
            INSERT INTO transactions (userId, type, title, amount, date)
            VALUES (?, 'in', 'Пополнение баланса', ?, ?)
        `, [userId, amount, new Date().toISOString()]);
        const user = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Вывести средства
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const user = await db.get(`SELECT balance FROM users WHERE id = ?`, [userId]);
        if (!user || user.balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }
        await db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [amount, userId]);
        await db.run(`
            INSERT INTO transactions (userId, type, title, amount, date)
            VALUES (?, 'out', 'Вывод средств', ?, ?)
        `, [userId, -amount, new Date().toISOString()]);
        const updated = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
        res.json({ user: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получить историю транзакций пользователя
app.get('/api/user/:userId/transactions', async (req, res) => {
    try {
        const txs = await db.all(`
            SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC
        `, [req.params.userId]);
        res.json({ transactions: txs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ Админские API ============
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await db.all(`SELECT * FROM users WHERE isAdmin = 0`);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/verify/:userId', async (req, res) => {
    try {
        await db.run(`UPDATE users SET verified = 1 WHERE id = ?`, [req.params.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/block/:userId', async (req, res) => {
    try {
        const user = await db.get(`SELECT blocked FROM users WHERE id = ?`, [req.params.userId]);
        const newVal = user.blocked ? 0 : 1;
        await db.run(`UPDATE users SET blocked = ? WHERE id = ?`, [newVal, req.params.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/items', async (req, res) => {
    try {
        const items = await db.all(`SELECT * FROM items`);
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/rentals', async (req, res) => {
    try {
        const rentals = await db.all(`SELECT * FROM rentals`);
        res.json({ rentals });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/transactions', async (req, res) => {
    try {
        const txs = await db.all(`SELECT * FROM transactions ORDER BY date DESC`);
        res.json({ transactions: txs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Автоматическое продление аренд (запускается по таймеру)
app.post('/api/cron/extend-rentals', async (req, res) => {
    try {
        const now = Date.now();
        const active = await db.all(`SELECT * FROM rentals WHERE status = 'active'`);
        let extended = 0;
        for (const r of active) {
            const end = new Date(r.endDate).getTime();
            if (now > end) {
                const newEnd = new Date(end + 86400000);
                await db.run(`UPDATE rentals SET endDate = ? WHERE id = ?`, [newEnd.toISOString().slice(0,10), r.id]);
                // Дополнительная плата
                const diffDays = Math.ceil((newEnd - new Date(r.startDate).getTime()) / 86400000);
                const extra = Math.round(r.price / diffDays);
                if (extra > 0) {
                    await db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [extra, r.renterId]);
                    await db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [extra, r.ownerId]);
                    await db.run(`
                        INSERT INTO transactions (userId, type, title, amount, date)
                        VALUES (?, 'out', 'Автопродление: ' || ?, ?, ?)
                    `, [r.renterId, r.itemName, -extra, new Date().toISOString()]);
                }
                extended++;
            }
        }
        res.json({ extended });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});