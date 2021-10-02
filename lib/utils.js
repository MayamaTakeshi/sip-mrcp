require('magic-globals')
const path = require('path')

var safe_write = (conn, msg) => {
    try {
        if(!conn.destroyed) {
            conn.write(msg)
        }
    } catch(e) {
        console.error("safe_write catched:")
        console.error(e)
    }
}

var gen_random_int = (max) => {
    return Math.floor(Math.random() * Math.floor(max));
}

module.exports = {
    filename: () => {
        var filepath = __stack[1].getFileName()
        return path.basename(filepath)
    },

    safe_write,

    gen_random_int,
}
