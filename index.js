const express = require("express")
const axios = require("axios")
const path = require("path")
const iconv = require("iconv-lite")
const jsdom = require("jsdom")

const app = express()
const PORT = process.env.PORT || 12358
const USER_AGENT = { headers: { "User-Agent": "Chrome/5.0" } }

const REGEX = {
    health: /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\]/i,
    mana: /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\] \(Мана\)/i,
    extra: /\(Уровень\sжизни\s\(HP\)\:\s+?\+(\d{3,4})\)/,
    url: /^https:\/\/[^\/]+\.combats\.com\/logs\.pl\?log=\d+\.\d+/i,
    protect:
        /Призрачн(?:ое|ый|ая) (Лезвие|Удар|Топор|Кинжал|Огонь|Вода|Воздух|Земля|защита)/,
}

const HEAL_TYPES = {
    healthHeals: ["Восстановление энергии", "Исцеление"],
    manaHeals: ["Восстановление Маны", "Прозрение"],
    extraHealth: ["Резерв сил", "Из последних сил"],
}

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
        return res.status(400).send("Invalid URI format.")
    }

    try {
        const statistics = await parseLogs(uri)
        res.json(statistics)
    } catch (error) {
        console.error("Error parsing logs:", error.message)
        res.status(500).json({ error: error.message })
    }
})

// Helper to validate and sanitize URI
function isValidUri(uri) {
    return REGEX.url.test(uri)
}

function sanitizeUri(uri) {
    return uri.includes("#end") ? uri : `${uri}&${Math.random()}#end`
}

// Parse log data
async function parseLogs(uri) {
    try {
        const response = await axios.get(uri, {
            ...USER_AGENT,
            responseType: "arraybuffer",
        })
        const decodedHtml = iconv.decode(response.data, "windows-1251")
        const dom = new jsdom.JSDOM(decodedHtml)

        let statistics = extractBattleMeta(dom)
        if (statistics.players.length === 0) {
            return statistics
        }

        return await parseBattleLog(uri, statistics)
    } catch (error) {
        throw new Error(`Failed to fetch logs from ${uri}: ${error.message}`)
    }
}

// Extract battle metadata and player info
function extractBattleMeta(dom) {
    const statistics = { players: [] }
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
                team: el.querySelector("font")?.className,
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
            ...USER_AGENT,
            responseType: "arraybuffer",
        })
        const content = iconv.decode(response.data, "windows-1251")

        if (content.includes("Ничего не найдено.")) {
            throw new Error("Invalid log data.")
        }

        player.stolb = 0
        player.extra = 0
        player.protect = 0
        player.mana = 0
        player.healed = 0

        const dom = new jsdom.JSDOM(content)
        processLogEntries(dom.window.document.body.innerHTML, player)
    }
    return stats
}

// Process log entries for each player
function processLogEntries(logEntries, player) {
    const cleanEntries = cleanLogEntries(logEntries)

    cleanEntries.forEach((entry) => {
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

function getBattleTypeMappings() {
    return [
        {
            regex: /Клановое сражение \+1 в нападении/,
            type: "Клановое сражение +1 в нападении",
            image: "https://img.combats.com/i/items/attackclana.gif",
        },
        {
            regex: /Клановое сражение/,
            type: "Клановое сражение",
            image: "https://img.combats.com/i/items/attackclana.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 1 на 1/,
            type: "Регулярный Клановый Вызов 1 на 1",
            image: "https://img.combats.com/i/items/sp_clan_perm_call1toend.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 3 на 3/,
            type: "Регулярный Клановый Вызов 3 на 3",
            image: "https://img.combats.com/i/items/sp_clan_perm_call3.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 4 на 4/,
            type: "Регулярный Клановый Вызов 4 на 4",
            image: "https://img.combats.com/i/items/sp_clan_perm_call4.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 6 на 6/,
            type: "Регулярный Клановый Вызов 6 на 6",
            image: "https://img.combats.com/i/items/sp_clan_perm_call6.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 7 на 7/,
            type: "Регулярный Клановый Вызов 7 на 7",
            image: "https://img.combats.com/i/items/sp_clan_perm_call7.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 7 на 12/,
            type: "Регулярный Клановый Вызов 7 на 12",
            image: "https://img.combats.com/i/items/sp_clan_perm_call7x12.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 10 на 10/,
            type: "Регулярный Клановый Вызов 10 на 10",
            image: "https://img.combats.com/i/items/sp_clan_perm_call10.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 12 на 12/,
            type: "Регулярный Клановый Вызов 12 на 12",
            image: "https://img.combats.com/i/items/sp_clan_perm_call12.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 25 на 25/,
            type: "Регулярный Клановый Вызов 25 на 25",
            image: "https://img.combats.com/i/items/sp_clan_perm_call25.gif",
        },
        {
            regex: /Регулярный Клановый Вызов 50 на 50/,
            type: "Регулярный Клановый Вызов 50 на 50",
            image: "https://img.combats.com/i/items/sp_clan_perm_call50.gif",
        },
        {
            regex: /Клановый Вызов/,
            type: "Клановый Вызов",
            image: "http://img.combats.com/i/items/sp_clan_call.gif",
        },
        {
            regex: /Нелечимая травма на 24 часа/,
            type: "Нелечимая травма на 24 часа",
            image: "https://img.combats.com/i/items/attackt1.gif",
        },
        {
            regex: /Нелечимая травма на три дня/,
            type: "Нелечимая травма на три дня",
            image: "https://img.combats.com/i/items/attackt4320.gif",
        },
        {
            regex: /Бой Клан-Лиги/,
            type: "Бой Клан-Лиги",
            image: "https://img.combats.com/i/items/attackclana.gif",
        },
        {
            regex: /Групповой Конфликт/,
            type: "Групповой Конфликт",
            image: "https://img.combats.com/i/fighttype1.gif",
        },
    ]
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`)
})
