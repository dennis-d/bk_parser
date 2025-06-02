// scraper.js

const axios = require("axios")
const iconv = require("iconv-lite")
const jsdom = require("jsdom")
const { JSDOM } = jsdom

/**
 * BK‑Parser Scraper
 * -----------------
 * Scrapes player and clan pages from Combats.com and extracts structured
 * metadata such as"legendary_items, rune qualities, player status, etc.
 *
 * Design notes:
 *  • Network requests are throttled via a tiny Semaphore (see below).
 *  • Pattern definitions are declared once as top‑level constants.
 *  • Each extract* helper returns plain objects that are aggregated inside
 *    `scrapeAndCountKeywords`.
 *
 * Author: Dennis
 */

// === Simple semaphore for rate limiting ===
/**
 * Simple semaphore used for concurrency control.
 * @example
 * const sem = new Semaphore(2);
 * await sem.acquire();
 * // …do async work
 * sem.release();
 */
class Semaphore {
    constructor(count) {
        this.count = count
        this.waiters = []
    }
    async acquire() {
        if (this.count > 0) {
            this.count--
            return
        }
        return new Promise((resolve) => {
            this.waiters.push(resolve)
        })
    }
    release() {
        if (this.waiters.length > 0) {
            const waiter = this.waiters.shift()
            waiter()
        } else {
            this.count++
        }
    }
}

// Maximum number of concurrent HTTP requests
const MAX_CONCURRENT_REQUESTS = 2
// Rate limiter:
const rateLimiter = new Semaphore(MAX_CONCURRENT_REQUESTS)

// === Utility Functions ===

// Sleep for a given number of milliseconds
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Decode a Windows-1251 response buffer into UTF-8 text
function decode1251(buffer) {
    return iconv.decode(buffer, "windows-1251")
}

// Split HTML text into lines
function getHtmlLines(htmlText) {
    return htmlText.split(/\r?\n/)
}

// === Pattern Definitions ===

// Legendary item regex patterns
const LEGENDARY_PATTERNS = {
    OMCL: /Истинная Корона Царя Цветов/i,
    OML: /Корона Царя Цветов L/i,
    OFCL: /Истинная Корона Царицы Цветов/i,
    FCL: /Корона Царицы Цветов/i,
    OCLL: /Истинный Плащ Вечного Цикла L/i,
    CLL: /Плащ Вечного Цикла L/i,
    CLSP: /Плащ Весны L/i,
    CLSM: /Плащ Лета L/i,
    CLAU: /Плащ Осени L/i,
    CLWI: /Плащ Зимы L/i,
    BAF0: /.*Bow of Amber Forest L.*/i,
    BAF1: /.*Bow of Amber Forest \+1 L.*/i,
    BAF2: /.*Bow of Amber Forest \+2 L.*/i,
    BAF3: /.*Bow of Amber Forest \+3 L.*/i,
    BAF4: /.*Bow of Amber Forest \+4 L.*/i,
    BAF5: /.*Bow of Amber Forest \+5 L.*/i,
    APL0: /.*Axe of Primal Law L/i,
    APL1: /.*Axe of Primal Law \+1 L.*/i,
    APL2: /.*Axe of Primal Law \+2 L.*/i,
    APL3: /.*Axe of Primal Law \+3 L.*/i,
    APL4: /.*Axe of Primal Law \+4 L.*/i,
    APL5: /.*Axe of Primal Law \+5 L.*/i,
    APO0: /.*Axe of Primal Order L.*/i,
    APO1: /.*Axe of Primal Order \+1 L.*/i,
    APO2: /.*Axe of Primal Order \+2 L.*/i,
    APO3: /.*Axe of Primal Order \+3 L.*/i,
    APO4: /.*Axe of Primal Order \+4 L.*/i,
    APO5: /.*Axe of Primal Order \+5 L.*/i,
    CCB0: /.*Crossbow of Crimson Bones L.*/i,
    CCB1: /.*Crossbow of Crimson Bones \+1 L.*/i,
    CCB2: /.*Crossbow of Crimson Bones \+2 L.*/i,
    CCB3: /.*Crossbow of Crimson Bones \+3 L.*/i,
    CCB4: /.*Crossbow of Crimson Bones \+4 L.*/i,
    CCB5: /.*Crossbow of Crimson Bones \+5 L.*/i,
    DGS0: /.*Dagger of Gold Serpent L.*/i,
    DGS1: /.*Dagger of Gold Serpent \+1 L.*/i,
    DGS2: /.*Dagger of Gold Serpent \+2 L.*/i,
    DGS3: /.*Dagger of Gold Serpent \+3 L.*/i,
    DGS4: /.*Dagger of Gold Serpent \+4 L.*/i,
    DGS5: /.*Dagger of Gold Serpent \+5 L.*/i,
    DBS0: /.*Dagger of Black Serpent L.*/i,
    DBS1: /.*Dagger of Black Serpent \+1 L.*/i,
    DBS2: /.*Dagger of Black Serpent \+2 L.*/i,
    DBS3: /.*Dagger of Black Serpent \+3 L.*/i,
    DBS4: /.*Dagger of Black Serpent \+4 L.*/i,
    DBS5: /.*Dagger of Black Serpent \+5 L.*/i,
    HIM0: /.*Hammer of Iron Majesty L.*/i,
    HIM1: /.*Hammer of Iron Majesty \+1 L.*/i,
    HIM2: /.*Hammer of Iron Majesty \+2 L.*/i,
    HIM3: /.*Hammer of Iron Majesty \+3 L.*/i,
    HIM4: /.*Hammer of Iron Majesty \+4 L.*/i,
    HIM5: /.*Hammer of Iron Majesty \+5 L.*/i,
    SIG0: /.*Shield of Iron Gryphon L.*/i,
    SIG1: /.*Shield of Iron Gryphon \+1 L.*/i,
    SIG2: /.*Shield of Iron Gryphon \+2 L.*/i,
    SIG3: /.*Shield of Iron Gryphon \+3 L.*/i,
    SIG4: /.*Shield of Iron Gryphon \+4 L.*/i,
    SIG5: /.*Shield of Iron Gryphon \+5 L.*/i,
    SBG0: /.*Sword of Blessed Glory L.*/i,
    SBG1: /.*Sword of Blessed Glory \+1 L.*/i,
    SBG2: /.*Sword of Blessed Glory \+2 L.*/i,
    SBG3: /.*Sword of Blessed Glory \+3 L.*/i,
    SBG4: /.*Sword of Blessed Glory \+4 L.*/i,
    SBG5: /.*Sword of Blessed Glory \+5 L.*/i,
    SUD0: /.*Sword of Unholy Desire L.*/i,
    SUD1: /.*Sword of Unholy Desire \+1 L.*/i,
    SUD2: /.*Sword of Unholy Desire \+2 L.*/i,
    SUD3: /.*Sword of Unholy Desire \+3 L.*/i,
    SUD4: /.*Sword of Unholy Desire \+4 L.*/i,
    SUD5: /.*Sword of Unholy Desire \+5 L.*/i,
    SAJ0: /.*Staff of Ancient Jungle L.*/i,
    SAJ1: /.*Staff of Ancient Jungle \+1 L.*/i,
    SAJ2: /.*Staff of Ancient Jungle \+2 L.*/i,
    SAJ3: /.*Staff of Ancient Jungle \+3 L.*/i,
    SAJ4: /.*Staff of Ancient Jungle \+4 L.*/i,
    SAJ5: /.*Staff of Ancient Jungle \+5 L.*/i,
    SFD0: /.*Staff of Frozen Den L.*/i,
    SFD1: /.*Staff of Frozen Den \+1 L.*/i,
    SFD2: /.*Staff of Frozen Den \+2 L.*/i,
    SFD3: /.*Staff of Frozen Den \+3 L.*/i,
    SFD4: /.*Staff of Frozen Den \+4 L.*/i,
    SFD5: /.*Staff of Frozen Den \+5 L.*/i,
    SLC0: /.*Staff of Lava Claw L.*/i,
    SLC1: /.*Staff of Lava Claw \+1 L.*/i,
    SLC2: /.*Staff of Lava Claw \+2 L.*/i,
    SLC3: /.*Staff of Lava Claw \+3 L.*/i,
    SLC4: /.*Staff of Lava Claw \+4 L.*/i,
    SLC5: /.*Staff of Lava Claw \+5 L.*/i,
    SLV0: /.*Staff of Lightning Vessel L.*/i,
    SLV1: /.*Staff of Lightning Vessel \+1 L.*/i,
    SLV2: /.*Staff of Lightning Vessel \+2 L.*/i,
    SLV3: /.*Staff of Lightning Vessel \+3 L.*/i,
    SLV4: /.*Staff of Lightning Vessel \+4 L.*/i,
    SLV5: /.*Staff of Lightning Vessel \+5 L.*/i,
}

// Excluded legendary codes
const EXCLUDED_LEGENDARY_CODES = new Set([
    "OWSL",
    "OSWSL",
    "WSL",
    "SWSL",
    "ORSL",
    "OSRSL",
    "RSL",
    "SRSL",
    "OMSL",
    "OSMSL",
    "MSL",
    "SMSL",
    "RF",
    "CrF",
    "ErF",
    "EdF",
    "AF",
    "ChF",
])

// Staff groups for legendary grouping
const STAFF_GROUPS = {
    SAJ: ["SAJ0", "SAJ1", "SAJ2", "SAJ3", "SAJ4", "SAJ5"],
    SFD: ["SFD0", "SFD1", "SFD2", "SFD3", "SFD4", "SFD5"],
    SLC: ["SLC0", "SLC1", "SLC2", "SLC3", "SLC4", "SLC5"],
    SLV: ["SLV0", "SLV1", "SLV2", "SLV3", "SLV4", "SLV5"],
}

// Rune patterns in priority order
const RUNE_PATTERNS = [
    {
        pattern: /Встроена руна: Теневая руна Додека Бауни L \[12\]/,
        label: "matrix",
    },
    { pattern: /Встроена руна: Додека Бауни L \[12\]/, label: "bauni_l" },
    { pattern: /Встроена руна:.*L \[12\]/, label: "L" },
    { pattern: /Встроена руна: Додека Бауни U \[12\]/, label: "bauni_u" },
    { pattern: /Встроена руна:.*U \[12\]/, label: "U" },
    { pattern: /Встроена руна: Додека Бауни ER \[12\]/, label: "bauni_er" },
    { pattern: /Встроена руна:.*ER \[12\]/, label: "ER" },
    { pattern: /Встроена руна:.*VR \[12\]/, label: "VR" },
]

// Shirt quality patterns
const SHIRT_PATTERNS = {
    "8R": /.*Hauberk of Inspiration|.*Vest of Inspiration|.*Shirt of Inspiration/i,
    "8VR": /.*Ring-mail of Inspiration|.*Jacket of Inspiration|.*Garb of Inspiration/i,
    "9R": /.*Hauberk of Serenity|.*Vest of Serenity|.*Shirt of Serenity/i,
    "9VR": /.*Ring-mail of Serenity|.*Jacket of Serenity|.*Garb of Serenity/i,
    "10R": /.*Hauberk of Suppression|.*Vest of Suppression|.*Shirt of Suppression/i,
    "10VR": /.*Ring-mail of Suppression|.*Jacket of Suppression|.*Garb of Suppression/i,
    "10ER": /.*Chain-mail of Suppression|.*Waistcoat of Suppression|.*Tunic of Suppression/i,
    "11R": /.*Hauberk of Expectation|.*Vest of Expectation|.*Shirt of Expectation/i,
    "11VR": /.*Ring-mail of Expectation|.*Jacket of Expectation|.*Garb of Expectation/i,
    "11ER": /.*Chain-mail of Expectation|.*Waistcoat of Expectation|.*Tunic of Expectation/i,
    "12R": /.*Hauberk of Depression|.*Vest of Depression|.*Shirt of Depression/i,
    "12VR": /.*Ring-mail of Depression|.*Jacket of Depression|.*Garb of Depression/i,
    "12ER": /.*Chain-mail of Depression|.*Waistcoat of Depression|.*Tunic of Depression/i,
    "12U": /.*Bearclaw Hauberk U.*|.*Vest of Black Butterfly|.*Mantle of Sapphirine Charms/i,
    "12L": /.*Ring-mail of Bloody End|.*Jacket of Violet Shadows|.*Carapace of Mystery Scars/i,
}

// Regex to extract player drwfl data
const DRWFL_REGEX =
    /drwfl\("([^"]+)",(\d+),"(\d+)",(\d+),"([^"]*)"(?:,"[^"]*"){0,3}\)/

// Regex to extract class info
const CLASS_REGEXES = [
    /<div class="logo"><IMG src="http:\/\/img\.combats\.com\/roles\/[Lb]\/(\d+)\.png" title="([^"]+)"><\/div>/i,
    /<IMG src="http:\/\/img\.combats\.com\/roles\/[Lb]\/(\d+)\.png" title="([^"]+)"/i,
]

// Regex to detect invisibility tooltip
const INVIS_REGEX =
    /onmouseover='CombatsUI\.ShowTooltip\("<B><U>Вуаль невидимости<\/U><\/B> \(Эффект\)<BR>Осталось: (?:(\d+) мин\.)?(?: ?(\d+) сек\.)? <BR>'/

// Regex to extract DrawOnline info
const DRAWONLINE_REGEX =
    /DrawOnline\((\d+|["']hide["']),(\d+|["']online["']|["']hide["'])\)/

// City name → code map
const CITY_NAME_TO_CODE = {
    "Abandoned Plain": "ABA",
    "Angels city": "ANG",
    "Capital city": "CAP",
    "Demons city": "DEM",
    "Devils city": "DEV",
    "Dreams city": "DRE",
    "East city": "EAS",
    "Emeralds city": "EME",
    Mooncity: "MOO",
    Sandcity: "SAN",
    Suncity: "SUN",
}

/**
 * Default/placeholder values returned when a particular
 * attribute is absent on a player page.
 */
const DEFAULT_PLAYER_DATA = {
    online_status: { status: "unknown", duration: null, invis_time: null },
    name: "N/A",
    level: "N/A",
    alignment_id: "0",
    clan: "No Clan",
    class_id: "0",
    class_name: "N/A",
    city_code: "UNK",
    legendary_count: 0,
    legendary_items: [],
    inner_flame_total: 0,
    inner_flame_items: [],
    clan_unique_total: 0,
    clan_unique_items: [],
    shirt_quality: "N/A",
    dominant_rune: "N/A",
    rune_qualities: {},
}

// ===================== Keyword Extraction Helpers =====================
/**
 * Scans HTML lines for legendary equipment.
 * @param {string[]} lines – HTML split into lines.
 * @returns {{ totalCount:number, itemsFound:string[] }}
 */
function extractLegendaryItems(lines) {
    let totalCount = 0
    const itemsFound = []
    const processedStaffs = new Set()

    lines.forEach((line, index) => {
        for (const [code, regex] of Object.entries(LEGENDARY_PATTERNS)) {
            if (regex.test(line)) {
                const staffGroup = Object.entries(STAFF_GROUPS).find(
                    ([, group]) => group.includes(code)
                )?.[0]

                if (staffGroup) {
                    if (!processedStaffs.has(staffGroup)) {
                        totalCount++
                        const groupCodes = STAFF_GROUPS[staffGroup]
                        const chosen = groupCodes.find(
                            (c) => !EXCLUDED_LEGENDARY_CODES.has(c)
                        )
                        if (chosen) itemsFound.push(chosen)
                        processedStaffs.add(staffGroup)
                    }
                } else {
                    totalCount++
                    if (!EXCLUDED_LEGENDARY_CODES.has(code))
                        itemsFound.push(code)
                }
            }
        }
    })

    return { totalCount, itemsFound }
}

/**
 * Parses rune information and determines the dominant quality.
 * @param {string[]} lines – HTML split into lines.
 * @returns {{ qualities:Object, dominant:string|null }}
 */
function extractRunes(lines) {
    const runeCounts = {
        VR: 0,
        ER: 0,
        bauni_er: 0,
        U: 0,
        bauni_u: 0,
        L: 0,
        bauni_l: 0,
        matrix: 0,
    }
    const processed = new Set()

    lines.forEach((line, index) => {
        const key = `${index}:${line}`
        if (processed.has(key)) return

        for (const { pattern, label } of RUNE_PATTERNS) {
            if (pattern.test(line)) {
                runeCounts[label]++
                processed.add(key)
                break
            }
        }
    })

    const qualities = {}
    Object.entries(runeCounts).forEach(([k, v]) => {
        if (v > 0) qualities[k] = v
    })

    let dominant = null
    if (Object.values(runeCounts).some((v) => v > 0)) {
        const maxCount = Math.max(...Object.values(runeCounts))
        const tiedQualities = Object.entries(runeCounts)
            .filter(([, v]) => v === maxCount)
            .map(([k]) => k)
        const priority = [
            "matrix",
            "bauni_l",
            "L",
            "bauni_u",
            "U",
            "bauni_er",
            "ER",
            "VR",
        ]
        dominant = priority.find((p) => tiedQualities.includes(p))
    }

    return { qualities, dominant }
}

function extractPlayerInfo(html) {
    const match = html.match(DRWFL_REGEX)
    if (!match) return {}
    const [, name, id, level, alignmentId, clanName] = match
    return {
        name: name,
        player_id: id,
        level: level,
        alignment_id: alignmentId,
        clan: clanName || "No Clan",
    }
}

function extractClassInfo(html) {
    for (const regex of CLASS_REGEXES) {
        const match = html.match(regex)
        if (match) {
            return {
                class_id: match[1],
                class_name: match[2],
            }
        }
    }
    return {}
}

function extractInvisibility(html) {
    const match = html.match(INVIS_REGEX)
    if (!match) return null
    const minutes = parseInt(match[1] || "0", 10)
    const seconds = parseInt(match[2] || "0", 10)
    return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`
}

function extractOnlineStatus(html) {
    const match = html.match(DRAWONLINE_REGEX)
    const currentTime = Math.floor(Date.now() / 1000)

    if (match) {
        const last = match[1].replace(/['"]/g, "")
        const flag = match[2].replace(/['"]/g, "")

        if (last === "hide" || flag === "hide") {
            return {
                status: "invisible",
                duration: null,
                invis_time: extractInvisibility(html),
            }
        }
        if (flag === "online") {
            return { status: "online", duration: null, invis_time: null }
        }
        const lastTime = parseInt(last, 10)
        const diff = currentTime - lastTime
        return { status: "offline", duration: diff, invis_time: null }
    }

    return { status: "unknown", duration: null, invis_time: null }
}

function extractCityCode(html) {
    const regex =
        /<td[^>]*?>\s*(Abandoned Plain|Angels city|Capital city|Demons city|Devils city|Dreams city|East city|Emeralds city|Mooncity|Sandcity|Suncity)\s*<\/td>.*?<script[^>]*?>DrawOnline/i
    const match = html.match(regex)
    if (!match) return "UNK"
    return CITY_NAME_TO_CODE[match[1].trim()] || "UNK"
}

function detectShirtQuality(html) {
    for (const [quality, pattern] of Object.entries(SHIRT_PATTERNS)) {
        if (pattern.test(html)) {
            return quality
        }
    }
    return "N/A"
}

function extractInnerFlame(html) {
    const patterns = {
        RF: /.*Ring of Inner Flame.*/i,
        CrF: /.*Circle of Inner Flame.*/i,
        ErF: /.*Earrings of Inner Flame.*/i,
        EdF: /.*Eardrops of Inner Flame L.*/i,
        AF: /.*Amulet of Inner Flame.*/i,
        ChF: /.*Сharm of Inner Flame L.*/i,
    }
    const items = []
    let total = 0

    Object.entries(patterns).forEach(([code, regex]) => {
        const matches = html.match(new RegExp(regex, "gi")) || []
        matches.forEach(() => items.push(code))
        total += matches.length
    })

    return { total, items }
}

function extractClanUniques(html) {
    const patterns = {
        WA: /.*Шлем Воплощения Храбрости U.*/i,
        WB: /.*Наручи Воплощения Храбрости U.*/i,
        WC: /.*Броня Воплощения Храбрости U.*/i,
        WD: /.*Ремень Воплощения Храбрости U.*/i,
        WE: /.*Серьги Воплощения Храбрости U.*/i,
        WF: /.*Амулет Воплощения Храбрости U.*/i,
        WG: /.*Печать Воплощения Храбрости U.*/i,
        WH: /.*Кольцо Воплощения Храбрости U.*/i,
        WI: /.*Перстень Воплощения Храбрости U.*/i,
        WJ: /.*Перчатки Воплощения Храбрости U.*/i,
        WK: /.*Поножи Воплощения Храбрости U.*/i,
        WL: /.*Сапоги Воплощения Храбрости U.*/i,
        RA: /.*Шлем Воплощения Точности U.*/i,
        RB: /.*Наручи Воплощения Точности U.*/i,
        RC: /.*Кольчуга Воплощения Точности U.*/i,
        RD: /.*Пояс Воплощения Точности U.*/i,
        RE: /.*Серьги Воплощения Точности U.*/i,
        RF: /.*Амулет Воплощения Точности U.*/i,
        RG: /.*Печать Воплощения Точности U.*/i,
        RH: /.*Кольцо Воплощения Точности U.*/i,
        RI: /.*Перстень Воплощения Точности U.*/i,
        RJ: /.*Перчатки Воплощения Точности U.*/i,
        RK: /.*Поножи Воплощения Точности U.*/i,
        RL: /.*Сапоги Воплощения Точности U.*/i,
        MA: /.*Маска Воплощения Строгости U.*/i,
        MB: /.*Браслеты Воплощения Строгости U.*/i,
        MC: /.*Балахон Воплощения Строгости U.*/i,
        MD: /.*Пояс Воплощения Строгости U.*/i,
        ME: /.*Серьги Воплощения Строгости U.*/i,
        MF: /.*Амулет Воплощения Строгости U.*/i,
        MG: /.*Печать Воплощения Строгости U.*/i,
        MH: /.*Кольцо Воплощения Строгости U.*/i,
        MI: /.*Перстень Воплощения Строгости U.*/i,
        MJ: /.*Перчатки Воплощения Строгости U.*/i,
        MK: /.*Штаны Воплощения Строгости U.*/i,
        ML: /.*Сапоги Воплощения Строгости U.*/i,
    }

    const items = []
    let total = 0

    Object.entries(patterns).forEach(([code, regex]) => {
        const matches = html.match(new RegExp(regex, "gi")) || []
        matches.forEach(() => items.push(code))
        total += matches.length
    })

    return { total, items }
}

/**
 * Fetches a player page and aggregates keyword statistics.
 * @param {string} url – Absolute URL of a player profile.
 * @returns {Promise<Object>} Map of extracted attributes.
 */
// === Main scraping function ===
async function scrapeAndCountKeywords(url, extras = true) {
    let htmlText
    const keywordCounts = {}

    try {
        await rateLimiter.acquire()

        const response = await axios.get(url, {
            responseType: "arraybuffer",
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 10000,
        })
        rateLimiter.release()
        htmlText = decode1251(response.data)
    } catch (err) {
        rateLimiter.release()
        console.error(`Error fetching ${url}: ${err.message}`)
        return { ["Error fetching URL"]: err.message }
    }
    const dom = new JSDOM(htmlText)
    const document = dom.window.document

    const ratingElement = document.querySelector(
        "div.division_score > small > b"
    )
    let rating = 0
    if (ratingElement) {
        let ratingText = ratingElement.textContent.trim()
        const ratingMatch = /Рейтинг: (\d+)$/.exec(ratingText)
        if (ratingMatch) {
            rating = parseInt(ratingMatch[1])
        }
    }
    keywordCounts["rating"] = rating
    const lines = getHtmlLines(htmlText)

    // collect all images in single object
    const itemImages = []
    document
        .querySelectorAll('img[src*="http://img.combats.com/i/items/"]')
        .forEach((img) => {
            const title = img.getAttribute("title")
            itemImages.push(title)
        })
    // Extract"legendary_items
    const { totalCount: legendaryCount, itemsFound: legendaryItems } =
        extractLegendaryItems(itemImages)
    if (legendaryCount > 0) {
        keywordCounts["legendary_count"] = legendaryCount
        keywordCounts["legendary_items"] = legendaryItems
    }

    // Extract runes
    const { qualities: runeQualities, dominant: dominantRune } =
        extractRunes(itemImages)
    if (Object.keys(runeQualities).length > 0) {
        keywordCounts["rune_qualities"] = runeQualities
    }
    if (dominantRune) {
        keywordCounts["dominant_rune"] = dominantRune
    }

    if (extras) {
        // Extract player info
        Object.assign(keywordCounts, extractPlayerInfo(htmlText))

        // Extract class info
        Object.assign(keywordCounts, extractClassInfo(htmlText))

        // Extract invisibility
        const invisibility = extractInvisibility(htmlText)
        if (invisibility) {
            keywordCounts["invisibility_time"] = invisibility
        }

        // Extract online status
        keywordCounts["online_status"] = extractOnlineStatus(htmlText)

        // Extract city code
        keywordCounts["city_code"] = extractCityCode(htmlText)
    }

    // Extract shirt quality
    keywordCounts["shirt_quality"] = detectShirtQuality(itemImages.join())

    // Extract inner flame items
    const { total: flameTotal, items: flameItems } = extractInnerFlame(
        itemImages.join()
    )
    if (flameTotal > 0) {
        keywordCounts["inner_flame_total"] = flameTotal
        keywordCounts["inner_flame_items"] = flameItems
    }

    // Extract clan-unique items
    const { total: uniqueTotal, items: uniqueItems } = extractClanUniques(
        itemImages.join()
    )
    if (uniqueTotal > 0) {
        keywordCounts["clan_unique_total"] = uniqueTotal
        keywordCounts["clan_unique_items"] = uniqueItems
    }

    return Object.keys(keywordCounts).length > 0
        ? keywordCounts
        : { "No keywords found": 0 }
}

// === Clan URL validation ===
function isValidClanUrl(clanUrl) {
    return /^https:\/\/[a-z0-9\-]+\.combats\.com\/clans_inf\.pl\?\w+$/.test(
        clanUrl
    )
}

// === Main clan parsing function ===
async function parseClan(clanUrl, socket) {
    if (!isValidClanUrl(clanUrl)) {
        return { error: "It is not a valid clan URL", results: null }
    }

    let clanHtml
    try {
        const resp = await axios.get(clanUrl, {
            responseType: "arraybuffer",
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 10000,
        })
        clanHtml = decode1251(resp.data)
    } catch (err) {
        console.error(`Error fetching clan page: ${err.message}`)
        return { error: `Error fetching clan: ${err.message}`, results: null }
    }

    // Extract the list of clan members
    const sectionMatch = clanHtml.match(
        /<b>Бойцы клана<\/b><br><br>\s*<ul class="column_users">(.*?)<\/ul>/s
    )
    if (!sectionMatch) {
        return { error: "No clan members found", results: null }
    }

    const clanSection = sectionMatch[1]
    const playerMatches = Array.from(
        clanSection.matchAll(
            /drwfl\("([^"]+)",(\d+),"(\d+)",(\d+),"([^"]*)"\)/g
        )
    )
    if (playerMatches.length === 0) {
        return { error: "No clan members found", results: null }
    }

    // Build an array of player URLs
    const domainMatch = clanUrl.match(/^https:\/\/([a-z0-9\-]+)\.combats\.com/)
    const baseDomain = domainMatch ? domainMatch[1] : null
    const playerUrls = playerMatches.map(
        (m) => `https://${baseDomain}.combats.com/inf.pl?${m[2]}`
    )

    const results = Array(playerUrls.length).fill(null)
    let processed = 0
    const concurrency = 5
    let inFlight = 0
    let cursor = 0

    return new Promise((resolve) => {
        async function processNext() {
            if (cursor >= playerUrls.length && inFlight === 0) {
                return resolve({ error: null, results })
            }

            while (inFlight < concurrency && cursor < playerUrls.length) {
                const index = cursor++
                inFlight++
                ;(async () => {
                    try {
                        let data = await scrapeAndCountKeywords(
                            playerUrls[index]
                        )

                        // Apply defaults if missing
                        const defaults = DEFAULT_PLAYER_DATA
                        if (typeof data !== "object" || data === null) {
                            data = {}
                        }
                        Object.entries(defaults).forEach(([k, v]) => {
                            if (!(k in data)) data[k] = v
                        })
                        results[index] = data
                    } catch (err) {
                        console.error(
                            `Error processing player ${index}: ${err.message}`
                        )
                        results[index] = { error: err.message }
                    } finally {
                        processed++
                        inFlight--
                        if (socket) {
                            socket.emit("progress_update", {
                                processed,
                                total: playerUrls.length,
                            })
                        }
                        processNext()
                    }
                })()
            }
        }
        processNext()
    })
}

module.exports = {
    getHtmlLines,
    LEGENDARY_PATTERNS,
    EXCLUDED_LEGENDARY_CODES,
    STAFF_GROUPS,
    RUNE_PATTERNS,
    SHIRT_PATTERNS,
    DRWFL_REGEX,
    CLASS_REGEXES,
    INVIS_REGEX,
    extractLegendaryItems,
    extractRunes,
    extractPlayerInfo,
    extractClassInfo,
    extractInvisibility,
    extractOnlineStatus,
    detectShirtQuality,
    extractInnerFlame,
    extractClanUniques,
    scrapeAndCountKeywords,
    parseClan,
}
