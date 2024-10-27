// sqliteCache.js
const sqlite3 = require("sqlite3").verbose()
const path = require("path")
const iconv = require("iconv-lite")

const DEFAULT_TIMEOUT = 60 * 1000 // 60 seconds
const LONG_TIMEOUT = 60 * 60 * 3 * 1000 // 3 hours

// Create or open the SQLite database
const db = new sqlite3.Database(path.join(__dirname, "combats.db"), (err) => {
    if (err) console.error("Error opening database:", err)
})

// Initialize the cache tables if they don't exist
db.run(
    `
    CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        timestamp INTEGER
    )
`
)
db.run(
    `
    CREATE TABLE IF NOT EXISTS long_cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        timestamp INTEGER
    )
`
)

db.run(
    `
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        clan TEXT,
        username TEXT,
        level INTEGER,
        align INTEGER,
        rating INTEGER
    )
`
)

// Function to get cached data by key from short-term cache
function getCache(key, maxAge = 45000) {
    return new Promise((resolve, reject) => {
        const cutoff = Date.now() - maxAge
        db.get(
            "SELECT value FROM cache WHERE key = ? AND timestamp > ?",
            [key, cutoff],
            (err, row) => {
                if (err) reject(err)
                resolve(row ? JSON.parse(row.value) : null)
            }
        )
    })
}

// Function to get data from the long-term cache
function getLongCache(key, maxAge = 60 * 60 * 2 * 1000) {
    // 2 hours by default
    return new Promise((resolve, reject) => {
        const cutoff = Date.now() - maxAge
        db.get(
            "SELECT value FROM long_cache WHERE key = ? AND timestamp > ?",
            [key, cutoff],
            (err, row) => {
                if (err) reject(err)
                resolve(row ? JSON.parse(row.value) : null)
            }
        )
    })
}

// Function to set data in short-term cache
function setCache(key, value) {
    const timestamp = Date.now()
    const stringValue = JSON.stringify(value)
    db.run(
        "INSERT OR REPLACE INTO cache (key, value, timestamp) VALUES (?, ?, ?)",
        [key, stringValue, timestamp],
        (err) => {
            if (err) console.error("Error setting cache:", err)
        }
    )
}

// Function to set data in long-term cache
function setLongCache(key, value) {
    const timestamp = Date.now()
    const stringValue = JSON.stringify(value)
    db.run(
        "INSERT OR REPLACE INTO long_cache (key, value, timestamp) VALUES (?, ?, ?)",
        [key, stringValue, timestamp],
        (err) => {
            if (err) console.error("Error setting long cache:", err)
        }
    )
}

// Function to clear expired entries in short-term cache
function clearExpired(maxAge = DEFAULT_TIMEOUT) {
    const cutoff = Date.now() - maxAge
    db.run("DELETE FROM cache WHERE timestamp < ?", [cutoff], (err) => {
        if (err) console.error("Error clearing expired cache entries:", err)
    })
}

// Function to clear expired entries in long-term cache
function clearExpiredLong(maxAge = LONG_TIMEOUT) {
    // 3 hours by default
    const cutoff = Date.now() - maxAge
    db.run("DELETE FROM long_cache WHERE timestamp < ?", [cutoff], (err) => {
        if (err)
            console.error("Error clearing expired long cache entries:", err)
    })
}

function addUser(user) {
    const { clan, username, user_id, level, align, rating } = user
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO users (user_id, clan, username, level, align, rating) VALUES (?, ?, ?, ?, ?, ?)`,
            [user_id, clan, username, level, align, rating],
            (err) => {
                if (err) {
                    console.error("Error adding user:", err)
                    reject(err)
                } else {
                    resolve(`User ${username} added to clan ${clan}.`)
                }
            }
        )
    })
}

// Function to retrieve and decode username from the database
function getUser(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM users WHERE user_id = ?`,
            [userId],
            (err, row) => {
                if (err) {
                    console.error("Error retrieving user:", err)
                    reject(err)
                } else if (row) {
                    resolve(row)
                } else {
                    resolve(null)
                }
            }
        )
    })
}

function removeUser(user_id) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM users WHERE user_id = ?`, [user_id], (err) => {
            if (err) {
                console.error("Error removing user:", err)
                reject(err)
            } else {
                resolve(`User with ID ${user_id} removed.`)
            }
        })
    })
}

function removeClan(clan) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM users WHERE clan = ?`, [clan], (err) => {
            if (err) {
                console.error("Error removing clan:", err)
                reject(err)
            } else {
                resolve(`All users from clan ${clan} removed.`)
            }
        })
    })
}

// Fetch users by clan
function getUsersByClan(clan, rating = 4000) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM users WHERE clan = ? and rating > ? ORDER BY rating DESC`,
            [clan, rating],
            (err, rows) => {
                if (err) {
                    console.error("Error fetching users:", err)
                    reject(err)
                } else {
                    resolve(rows)
                }
            }
        )
    })
}

module.exports = {
    getUser,
    addUser,
    removeUser,
    removeClan,
    getUsersByClan,
    getCache,
    getLongCache,
    setCache,
    setLongCache,
    clearExpired,
    clearExpiredLong,
    DEFAULT_TIMEOUT,
}
