const express = require("express")
const axios = require("axios")
const path = require("path")
const iconv = require("iconv-lite")
const jsdom = require("jsdom")
const fs = require("fs")
const https = require("https")
const morgan = require("morgan")

const DEFAULT_TIMEOUT = 30000 // 30 seconds
const LONG_TIMEOUT = 60 * 60 * 2 * 1000 // 2 hours
// SSL options
const sslOptions = {
    key: fs.readFileSync("server.key"),
    cert: fs.readFileSync("server.cert"),
}

const app = express()
const PORT = process.env.PORT || 12358
app.use(morgan(":remote-addr :method :url :status :response-time ms"))
const USER_AGENT = { headers: { "User-Agent": "Chrome/5.0" } }

const server = https.createServer(sslOptions, app)

const REGEX = {
    health: /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\]/i,
    mana: /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\] \(Мана\)/i,
    extra: /\(Уровень\sжизни\s\(HP\)\:\s+?\+(\d{3,4})\)/,
    log_id: /log=(\d+\.\d+)/,
    url: /^https:\/\/[^\/]+\.combats\.com\/logs\.pl\?log=\d+\.\d+/i,
    username: /<span\s+class=\"(b\d{1})\">([a-zA-Z0-9\s+\-\_]+)<\/span>/i,
    protect:
        /Призрачн(?:ое|ый|ая) (Лезвие|Удар|Топор|Кинжал|Огонь|Вода|Воздух|Земля|защита)/,
    barrier: /Кинетический Барьер/,
    snake: /Змеиная грация/,
    will: /Волевой Барьер/,
}

const HEAL_TYPES = {
    healthHeals: ["Восстановление энергии", "Исцеление"],
    manaHeals: ["Восстановление Маны", "Прозрение", "Духи Льда"],
    extraHealth: ["Резерв сил", "Из последних сил"],
}

const long_cache = {}
const cache = {}

// Middleware for parsing form data
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// Serve the HTML form to take the URI as input
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
})

// Handle form submission without reloading the page
app.post("/parse", async (req, res) => {
    const uri = sanitizeUri(req.body.uri)
    if (!isValidUri(uri)) {
        return res.status(400).send("Invalid URL format.")
    }

    const logId = getLogIdFromUri(uri)

    // Check if log data is cached and still valid (within 45 seconds)
    if (cache[logId] && Date.now() - cache[logId].timestamp < 45000) {
        return res.json(cache[logId].data) // Return cached data
    }

    try {
        const statistics = await parseLogs(uri)

        // Cache the result with a timestamp
        cache[logId] = {
            data: statistics,
            timestamp: Date.now(),
        }

        // Initialize long-term cache if not already present
        if (!long_cache[logId]) {
            long_cache[logId] = {
                los_muertos: { B1: new Set(), B2: new Set() },
            }
        }

        // Clear cache entries after specified timeouts
        setCacheTimeout(logId)

        // Update los_muertos sets
        statistics.players.forEach((player) => {
            statistics.los_muertos[player.team].delete(player.name)
        })

        // Merge current los_muertos data with long_cache using Sets
        long_cache[logId].los_muertos.B1 = new Set([
            ...long_cache[logId].los_muertos.B1,
            ...statistics.los_muertos.B1,
        ])
        long_cache[logId].los_muertos.B2 = new Set([
            ...long_cache[logId].los_muertos.B2,
            ...statistics.los_muertos.B2,
        ])

        // Convert Sets to arrays for the final response
        statistics.los_muertos.B1 = Array.from(long_cache[logId].los_muertos.B1)
        statistics.los_muertos.B2 = Array.from(long_cache[logId].los_muertos.B2)

        res.json(statistics)
    } catch (error) {
        console.error("Error parsing log:", error.message, error.stack)
        res.status(500).json({ error: error.message })
    }
})

// Helper function to set cache timeouts
function setCacheTimeout(logId) {
    setTimeout(() => {
        delete cache[logId]
    }, DEFAULT_TIMEOUT)

    setTimeout(() => {
        delete long_cache[logId]
    }, LONG_TIMEOUT)
}

// Helper to validate and sanitize URI
function isValidUri(uri) {
    return REGEX.url.test(uri)
}

function sanitizeUri(uri) {
    return uri.includes("#end") ? uri : `${uri}&${Math.random()}#end`
}

// Helper to extract log ID from the URI
function getLogIdFromUri(uri) {
    const match = uri.match(REGEX.log_id)
    return match ? match[0] : null
}

// Parse log data
async function parseLogs(uri) {
    try {
        const response = await axios.get(uri, {
            ...getRandomUserAgent(),
            responseType: "arraybuffer",
        })

        if (response.status == 429) {
            // Too many requests
            throw new Error(`Слишком много запросов, попробуйте поже...`)
        }
        const decodedHtml = iconv.decode(response.data, "windows-1251")
        const dom = new jsdom.JSDOM(decodedHtml)

        let statistics = extractBattleMeta(dom)
        if (statistics.players.length === 0) {
            return statistics
        }

        return await parseBattleLog(uri, statistics)
    } catch (error) {
        throw error
    }
}

// Extract battle metadata and player info
function extractBattleMeta(dom) {
    const statistics = {
        players: [],
        los_muertos: { B1: new Set(), B2: new Set() },
        battle_type: "Групповой Конфликт",
        battle_image: "https://img.combats.com/i/fighttype1.gif",
        max_allowed: 5,
    }
    const battleTypeMappings = getBattleTypeMappings()

    dom.window.document
        .querySelectorAll(
            'td[align="right"][width="100%"][style*="padding-right:20"][valign="top"]'
        )
        .forEach((element) => {
            const comment = element.textContent.trim()
            const match = battleTypeMappings.find((mapping) =>
                mapping.regex.test(comment)
            )
            if (match) {
                statistics.battle_type = match.type
                statistics.battle_image = match.image
                statistics.max_allowed = match.max_allowed
            }
        })

    statistics.battle_type = statistics.battle_type || "Групповой Конфликт"
    statistics.battle_image =
        statistics.battle_image || "https://img.combats.com/i/fighttype1.gif"

    extractPlayerData(dom, statistics)
    return statistics
}

// Extract player data from DOM
function extractPlayerData(dom, statistics) {
    dom.window.document.querySelectorAll("font.B9").forEach((el) => {
        const scriptTag = el.querySelector("script").textContent
        const healthText = el.nextSibling?.textContent
        const regex = /drwfl\("([^\"]+)",(\d+),"(\d+)",(\d+),"([^\"]+)"\)/
        const healthRegex = /\[(\d+)\/(\d+)\]/
        const match = regex.exec(scriptTag)
        const healthMatch = healthRegex.exec(healthText)

        if (match && healthMatch) {
            statistics.players.push({
                name: match[1],
                user_id: match[2],
                level: parseInt(match[3], 10),
                aligns: parseInt(match[4], 10),
                clan_name: match[5],
                team: el.querySelector("font")?.className.toUpperCase(),
                current_health: parseInt(healthMatch[1], 10),
                max_health: parseInt(healthMatch[2], 10),
            })
        }
    })
}

// Parse battle log data
async function parseBattleLog(log, stats) {
    const match = log.match(REGEX.url)
    for (let player of stats.players) {
        const url = getBaseURL(match[0], player.name)
        const response = await axios.get(url, {
            ...getRandomUserAgent(),
            responseType: "arraybuffer",
        })
        const content = iconv.decode(response.data, "windows-1251")

        if (content.includes("Ничего не найдено.")) {
            throw new Error("Invalid log data.")
        }

        player.stolb = 0
        player.extra = 0
        player.protect = 0
        player.snake = 0
        player.barrier = 0
        player.will = 0
        player.mana = 0
        player.healed = 0

        const dom = new jsdom.JSDOM(content)
        processLogEntries(dom.window.document.body.innerHTML, player, stats)
    }
    return stats
}

// Process log entries for each player
function processLogEntries(logEntries, player, stats) {
    const cleanEntries = cleanLogEntries(logEntries)

    cleanEntries.forEach((entry) => {
        // console.log(entry)
        if (REGEX.username.test(entry)) {
            const [_, group, username] = entry.match(REGEX.username)
            stats.los_muertos[group.toUpperCase()].add(username)
        }
        if (HEAL_TYPES.extraHealth.some((extra) => entry.includes(extra))) {
            const match = entry.match(REGEX.extra)
            if (match) {
                player.extra += parseInt(match[1], 10)
            }
        }
        if (HEAL_TYPES.healthHeals.some((heal) => entry.includes(heal))) {
            const match = entry.match(REGEX.health)
            if (match) {
                player.healed += parseInt(match[2], 10)
                player.max_health = parseInt(match[4], 10)
                player.original_health = player.max_health - player.extra
            }
        } else if (HEAL_TYPES.manaHeals.some((heal) => entry.includes(heal))) {
            const match = entry.match(REGEX.mana)
            if (match) {
                player.mana += parseInt(match[2], 10)
            }
        } else if (REGEX.protect.test(entry)) {
            player.protect += 1
        } else if (REGEX.barrier.test(entry)) {
            player.barrier += 1
        } else if (REGEX.snake.test(entry)) {
            player.snake += 1
        } else if (REGEX.will.test(entry)) {
            player.will += 1
        }
    })

    player.stolb = player.healed / (player.max_health - player.extra)
}

// Helper to clean log entries
function cleanLogEntries(logEntries) {
    logEntries = logEntries.replace(/<script.*?<\/script>/gis, "").split("<br>")
    return logEntries.filter(Boolean)
}

function getBaseURL(log, userName) {
    return `${log}&pp=&f=${userName}&f1=1`
}

function getRandomUserAgent() {
    const userAgents = [
        // Google Chrome on Desktop (Windows, macOS, Linux)
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",

        // Safari on Desktop (macOS)
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", // Example provided

        // Microsoft Edge on Desktop (Windows, macOS)
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.54",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36 Edg/90.0.818.56",
    ]

    // Randomly pick a user agent from the list
    const randomIndex = Math.floor(Math.random() * userAgents.length)
    const randomUserAgent = userAgents[randomIndex]

    // Return the output in the requested format
    return { headers: { "User-Agent": randomUserAgent } }
}

function getBattleTypeMappings() {
    return [
        {
            regex: /Клановое сражение \+1 в нападении/,
            type: "Клановое сражение +1 в нападении",
            image: "https://img.combats.com/i/items/attackclana.gif",
            max_allowed: 5,
        },
        {
            regex: /Клановое сражение/,
            type: "Клановое сражение",
            image: "https://img.combats.com/i/items/attackclana.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 1 на 1/,
            type: "Регулярный Клановый Вызов 1 на 1",
            image: "https://img.combats.com/i/items/sp_clan_perm_call1toend.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 3 на 3/,
            type: "Регулярный Клановый Вызов 3 на 3",
            image: "https://img.combats.com/i/items/sp_clan_perm_call3.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 4 на 4/,
            type: "Регулярный Клановый Вызов 4 на 4",
            image: "https://img.combats.com/i/items/sp_clan_perm_call4.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 6 на 6/,
            type: "Регулярный Клановый Вызов 6 на 6",
            image: "https://img.combats.com/i/items/sp_clan_perm_call6.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 7 на 7/,
            type: "Регулярный Клановый Вызов 7 на 7",
            image: "https://img.combats.com/i/items/sp_clan_perm_call7.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 7 на 12/,
            type: "Регулярный Клановый Вызов 7 на 12",
            image: "https://img.combats.com/i/items/sp_clan_perm_call7x12.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 10 на 10/,
            type: "Регулярный Клановый Вызов 10 на 10",
            image: "https://img.combats.com/i/items/sp_clan_perm_call10.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 12 на 12/,
            type: "Регулярный Клановый Вызов 12 на 12",
            image: "https://img.combats.com/i/items/sp_clan_perm_call12.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 25 на 25/,
            type: "Регулярный Клановый Вызов 25 на 25",
            image: "https://img.combats.com/i/items/sp_clan_perm_call25.gif",
            max_allowed: 5,
        },
        {
            regex: /Регулярный Клановый Вызов 50 на 50/,
            type: "Регулярный Клановый Вызов 50 на 50",
            image: "https://img.combats.com/i/items/sp_clan_perm_call50.gif",
            max_allowed: 5,
        },
        {
            regex: /Клановый Вызов/,
            type: "Клановый Вызов",
            image: "http://img.combats.com/i/items/sp_clan_call.gif",
            max_allowed: 5,
        },
        {
            regex: /Нелечимая травма на 24 часа/,
            type: "Нелечимая травма на 24 часа",
            image: "https://img.combats.com/i/items/attackt1.gif",
            max_allowed: 7,
        },
        {
            regex: /Нелечимая травма на три дня/,
            type: "Нелечимая травма на три дня",
            image: "https://img.combats.com/i/items/attackt4320.gif",
            max_allowed: 10,
        },
        {
            regex: /Бой Клан-Лиги/,
            type: "Бой Клан-Лиги",
            image: "https://img.combats.com/i/items/attackclana.gif",
            max_allowed: 5,
        },
        {
            regex: /Групповой Конфликт/,
            type: "Групповой Конфликт",
            image: "https://img.combats.com/i/fighttype1.gif",
            max_allowed: 5,
        },
    ]
}

// Start server
server.listen(PORT, () => {
    console.log(`Server running at https://localhost:${PORT}`)
})
