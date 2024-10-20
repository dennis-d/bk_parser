const express = require("express")
const axios = require("axios")
const path = require("path")
const iconv = require("iconv-lite")
const jsdom = require("jsdom")
// const fs = require("fs")
// const htmlDebug = fs.readFileSync("public/logs_klan.pl", "utf-8")

const app = express()
const PORT = 12358
const regexHealth =
    /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\]/i
const regexMana =
    /<font color=\"#006699\" title=\"<b>(.*?)<\/b>"><b>(\+\d+)<\/b><\/font>\s+?\[(\d+)\/(\d+)\] \(Мана\)/i
const regexExtra = /\(Уровень\sжизни\s\(HP\)\:\s+?\+(\d{3,4})\)/
const regexURL = /^https:\/\/[^\/]+\.combats\.com\/logs\.pl\?log=\d+\.\d+/i

const healthHeals = ["Восстановление энергии", "Исцеление"]
const manaHeals = ["Восстановление Маны", "Прозрение"]
const extraHealth = ["Резерв сил", "Из последних сил"]

const healthPattern = /\[(\d{3,5})\/(\d{3,5})\]/

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// Serve the HTML form to take the URI as input
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
})

// Handle form submission without reloading the page
app.post("/parse", async (req, res) => {
    let uri = req.body.uri
    if (!/^https:\/\/.+\.combats\.com\/logs\.pl\?log=.+/.test(uri)) {
        return res
            .status(400)
            .send("Invalid URI format. Please use a URI in the correct format.")
    }
    uri += uri.includes("#end") ? "" : `&${Math.random()}#end`
    try {
        res.json(await parseLogs(uri))
    } catch (error) {
        console.error("Error parsing logs:", error.message)
        console.error("Error parsing logs:", error.stack)
        res.status(500).send("Error parsing logs: " + error.message)
    }
})

async function parseLogs(uri) {
    const response = await axios.get(uri, {
        headers: { "User-Agent": "Chrome/5.0" },
        responseType: "arraybuffer", // Get the raw buffer
    })
    const dom = new jsdom.JSDOM(iconv.decode(response.data, "windows-1251"))

    let statistics = extractBattleMeta(dom)
    if (statistics.players.length > 0) {
        statistics = await parseBattleLog(uri, statistics)
    }

    return statistics
}

// Function to extract battle information
function extractBattleMeta(dom) {
    const statistics = { players: [] }
    const battleTypeMappings = [
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

    if (!statistics.battle_type) {
        statistics.battle_type = "Групповой Конфликт"
        statistics.battle_image = "https://img.combats.com/i/fighttype1.gif"
    }

    dom.window.document.querySelectorAll("font.B9").forEach((el) => {
        const scriptTag = el.querySelector("script").textContent
        const healthText = el.nextSibling && el.nextSibling.textContent
        const regex = /drwfl\("([^\"]+)",(\d+),"(\d+)",(\d+),"([^\"]+)"\)/
        const healthRegex = /\[(\d+)\/(\d+)\]/
        const match = regex.exec(scriptTag)
        const healthMatch = healthRegex.exec(healthText)

        if (match) {
            const characterName = match[1]
            const userId = match[2]
            const level = parseInt(match[3], 10)
            const aligns = parseInt(match[4], 10)
            const clanName = match[5]
            const characterTeam = el.querySelector("font")?.className
            const currentHealth = parseInt(healthMatch[1], 10)
            const maxHealth = parseInt(healthMatch[2], 10)

            statistics.players.push({
                name: characterName,
                user_id: userId,
                level,
                aligns,
                clan_name: clanName,
                team: characterTeam,
                current_health: currentHealth,
                max_health: maxHealth,
            })
        }
    })
    // console.log(statistics)
    return statistics
}

async function parseBattleLog(log, stats) {
    try {
        const match = log.match(regexURL)

        for (let player of stats.players) {
            const url = getBaseURL(match[0], player.name)
            const response = await axios.get(url, {
                headers: { "User-Agent": "Chrome/5.0" },
                responseType: "arraybuffer", // Get the raw buffer
            })
            const content = iconv.decode(response.data, "windows-1251")

            // Check for the specific string indicating an incorrect username
            if (content.includes("Ничего не найдено. Совсем не найдено.")) {
                console.error("Error: Incorrect username")
                return
            }

            // Check for the specific string indicating an incorrect log ID
            if (content.includes("Не найден лог этого боя")) {
                console.error("Error: Не найден лог этого боя")
                return
            }

            player.stolb = 0
            player.extra = 0
            // player.natisk = 0
            // player.krug = 0
            player.mana = 0
            player.healed = 0

            const dom = new jsdom.JSDOM(content)
            let logEntries = dom.window.document.body.innerHTML
            if (!logEntries) {
                console.error("Error: No content in response")
                return
            }
            const hrContentMatch = logEntries.match(/<HR>([\s\S]*?)<HR>/gi)
            logEntries = hrContentMatch ? hrContentMatch.join("") : ""

            logEntries = logEntries.replace(/<script.*?<\/script>/gis, "")
            logEntries = logEntries.split("<br>")

            logEntries.forEach((entry) => {
                if (extraHealth.some((extra) => entry.includes(extra))) {
                    const match = entry.match(regexExtra)
                    if (match) {
                        const [_, extra] = match
                        player["extra"] += parseInt(extra, 10)
                    }
                }
                if (healthHeals.some((heal) => entry.includes(heal))) {
                    const match = entry.match(regexHealth)
                    if (match) {
                        const [_, name, otheal, currentHealth, maxHealth] =
                            match
                        player.healed += parseInt(otheal, 10)
                        player.max_health = parseInt(maxHealth, 10)
                        player.original_health = parseInt(
                            maxHealth - player.extra,
                            10
                        )
                    }
                } else if (manaHeals.some((heal) => entry.includes(heal))) {
                    const match = entry.match(regexMana)
                    if (match) {
                        const [_, name, otheal, currentHealth, maxHealth] =
                            match
                        player.mana += parseInt(otheal, 10)
                    }
                } else {
                }
            })
            player.stolb = parseFloat(
                player.healed / (player.max_health - player.extra)
            )
        }
        return stats
    } catch (error) {
        console.error(error.message)
        console.error(error.stack)
    }
}

function getBaseURL(log, userName) {
    return `${log}&pp=&f=${userName}&f1=1`
}

// Serve the form as HTML
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`)
})
