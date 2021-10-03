const path = require('path')
const m = require('moment')

const logger = {
    level: 7,
    levels: {
        3: 'error',
        4: 'warn',
        5: 'info',
        7: 'debug',
    },
    log: (level, msg) => {
        if(level <= logger.level) {
            console.log(`${m().format("YYYY-MM-DD HH:mm:ss.SSS")} ${logger.levels[level]}: ${msg}`)
        }
    },
    set_log_function: log_function => {
        logger.log = log_function
    },
}

module.exports = logger
