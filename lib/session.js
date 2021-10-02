//require('magic-globals')

const EventEmitter = require("events")
const RtpSession = require('rtp-session')

const logger = require('./logger.js')

const log = (line, level, entity, msg) => {
    logger.log(level, entity, `(${FILE}:${line}) ${msg}`)
}

const gen_random_int = (max) => {
    return Math.floor(Math.random() * Math.floor(max))
}

class Session extends EventEmitter {
    constructor(data) {
        super()
        this.data = data
    }

    accept(answer_payload) {
        const rs_args = {
            payload_type: answer_payload,
            ssrc: gen_random_int(0xffffffff),
        }

        this.rs = new RtpSession(rs_args)
        this.rs.set_local_end_point(this.data.local_rtp_ip, this.data.local_rtp_port)
        this.rs.set_remote_end_point(this.data.sdp_data.remote_ip, this.data.sdp_data.remote_port)

        this.rs.on('error', err => {
            this.emit('error', err)
        })

        this.rs.on('data', data => {
            this.emit('rtp_data', data)
        })
    }

    refuse(response_status, response_reason) {
        const rs = response_status ? response_status : 403
        const rr = reponse_reason ? response_reason : 'Forbidden'
        this.data.sip_stack.send(sip.makeResponse(req, rs, rr))
        log(__line, 'debug', uuid, `INVITE refused with ${rs} ${rr} by app layer`)

        this.emit('refused')
    }
}

module.exports = Session