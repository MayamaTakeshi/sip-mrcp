const EventEmitter = require("events")
const RtpSession = require('rtp-session')
const log = require('tracing-log')

const utils = require('./utils.js')

const gen_random_int = (max) => {
    return Math.floor(Math.random() * Math.floor(max))
}

class Session extends EventEmitter {
    _setup_rtp_session(rs_args) {
        this.rtp_session = new RtpSession(rs_args)
        this.rtp_session.set_local_end_point(this.data.local_rtp_ip, this.data.local_rtp_port)
        this.rtp_session.set_remote_end_point(this.data.sdp_data.remote_ip, this.data.sdp_data.remote_rtp_port)

        this.rtp_session.on('error', err => {
            this.emit('error', err)
        })

        this.rtp_session.on('data', data => {
            this.emit('rtp_data', data)
        })
    }

    constructor(uuid, data) {
        super()
        this.active = true
        this.uuid = uuid
        this.data = data
        this.payload_type = data.sdp_data.rtp_payloads[0]

        if(data.direction == 'out') {
             const rs_args = {
                payload_type: data.sdp_data.rtp_payloads[0],
                preserve_headers: data.preserve_headers,
                ssrc: gen_random_int(0xffffffff),
            }
           
            this._setup_rtp_session(rs_args)
        }
    }

    accept(answer_payload) {
        this.payload_type = answer_payload

        const rs_args = {
            payload_type: this.payload_type.id,
            ssrc: gen_random_int(0xffffffff),
        }

        this._setup_rtp_session(rs_args)

        this.data.sm_stack.accept(this, answer_payload)
    }

    refuse(response_status, response_reason) {
        const rs = response_status ? response_status : 403
        const rr = response_reason ? response_reason : 'Forbidden'

        this.data.sm_stack.refuse(this, rs, rr)
    }

    terminate() {
        this.data.sm_stack.terminate(this)
    }

    send_mrcp_msg(msg) {
        if(!this.mrcp_socket) {
            log.error(`${this.uuid} mrcp_socket not ready`)
            return
        }

        utils.safe_write(this.mrcp_socket, msg)
    }

    send_rtp_data(data, marker_bit, payload_type) {
        if(!this.rtp_session) {
            log.error(`${this.uuid} rtp_session not ready`)
            return
        }

        if(!marker_bit) marker_bit = 0
        if(!payload_type) payload_type = this.payload_type.id

        this.rtp_session.send_payload(data, marker_bit, payload_type)
    }
}

module.exports = Session
