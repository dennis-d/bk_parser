module.exports = {
    apps: [
        {
            name: "Parser",
            max_memory_restart: "180M",
            script: "index.js",
            instances: 2, // Or 'max' to use all cores
            autorestart: true,
            exec_mode: "cluster", // Cluster mode to handle multiple requests
            watch: false, // Enable watching for file changes
            env: {
                NODE_ENV: "production",
            },
        },
        {
            name: "Scrabber",
            script: "scrabber.js", // entry for the scraping job
            exec_mode: "fork", // single instance, no clustering
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "200M",

            // PM2 will restart the app on this cron schedule instead of
            // relying on node‑cron inside the script.
            // Runs every 3 days at 03:00 UTC
            cron_restart: "0 3 */3 * *",

            env: {
                NODE_ENV: "production",
            },
        },
    ],
}
