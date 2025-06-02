const axios = require("axios")
const jsdom = require("jsdom")
const { JSDOM } = jsdom
const iconv = require("iconv-lite")

// const cron = require("node-cron")
const sqliteCache = require("./sqlCache")
const USER_AGENT = { headers: { "User-Agent": "Chrome/5.0" } }
const { scrapeAndCountKeywords } = require("./parser")

// Function to scrape clan information
async function scrapeClans() {
    try {
        const response = await axios.get(
            "https://capitalcity.combats.com/clans_inf.pl?allclans",
            USER_AGENT
        )
        const dom = new JSDOM(response.data)
        const document = dom.window.document

        const clanLinks = [
            ...document.querySelectorAll('td > a[href^="/clans_inf.pl?"]'),
        ]

        for (let link of clanLinks) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const clanName = link.textContent.trim()
            const clanUrl = `https://capitalcity.combats.com${link.getAttribute(
                "href"
            )}`
            await scrapeClanUsers(clanName, clanUrl)
        }
    } catch (error) {
        console.error("Error scraping clans:", error)
    }
}

// Function to scrape users from a specific clan
async function scrapeClanUsers(clanName, clanUrl) {
    try {
        const response = await axios.get(clanUrl, {
            responseType: "arraybuffer",
            ...USER_AGENT,
        })
        const content = iconv.decode(response.data, "windows-1251")

        const dom = new JSDOM(content)
        const document = dom.window.document

        const userListItems = [
            ...document.querySelectorAll("ul.column_users > li"),
        ]

        for (let userInfo of userListItems) {
            const scriptContent = userInfo.querySelector("script").textContent
            const userMatch =
                /drwfl\("([^"]+)",(\d+),"(\d+)",(\d+),".*"\)/.exec(
                    scriptContent
                )

            if (userMatch) {
                const username = userMatch[1]
                const user_id = parseInt(userMatch[2])
                const level = parseInt(userMatch[3])
                const align = parseInt(userMatch[4])
                if (level == 12) {
                    const stuff = await getUserStats(user_id)
                    const user = {
                        clan: clanName,
                        username,
                        user_id,
                        level,
                        align,
                        rating: stuff["rating"],
                        stuff: stuff,
                    }

                    // console.log(
                    //     `Adding user ${username} to clan ${clanName}...`
                    // )
                    await sqliteCache.addUser(user)
                }
            }
        }
    } catch (error) {
        console.error(`Error scraping users for clan ${clanName}:`, error)
    }
}

// Function to scrape user rating from user page
async function getUserStats(userId) {
    try {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const userUrl = `https://capitalcity.combats.com/inf.pl?${userId}`
        return await scrapeAndCountKeywords(userUrl, false)
    } catch (error) {
        console.error(`Error retrieving rating for user ${userId}:`, error)
        return { rating: 0, stuff: {} }
    }
}

// // Schedule the scraper to run every 3 days at 3 AM GMT
// cron.schedule(
//     "0 3 */3 * *",
//     () => {
//         scrapeClans()
//     },
//     {
//         timezone: "Etc/GMT",
//     }
// )
// Initial run
scrapeClans()
