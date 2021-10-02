//require('magic-globals')

const sip = require('sip')
const _ = require('lodash')
const mrcp = require('mrcp')
const mrcp_utils = require('mrcp-utils')
const uuid_v4 = require('uuid').v4
const Deque = require('collections/deque')

const Session = require('./session.js')

const logger = require('./logger.js')

const FILE = "stack.js"
const __line = "????"

const log = (line, level, entity, msg) => {
    logger.log(level, entity, `(${FILE}:${line}) ${msg}`)
}

const rstring = () => {
    return Math.floor(Math.random()*1e6).toString()
}

class SipMrcp {
    add_new_session(uuid, data) {
        const session = new Session(uuid, data)

        if(this.sessions[uuid]) {
            log(__line, 'error', uuid, `removing previous session with the same uuid`)
            const old_session = this.sessions[uuid]
            this.free_session(old_session)
        }

        this.sessions[uuid] = session

        session.on('error', err => {
            log(__line, 'error', uuid, `session error:${uuid}`)
            this.free_session(session)
        })

        session.on('refused', err => {
            log(__line, 'error', uuid, `session refused by app layer`)
            this.free_session(session)
        })

        return session
    }

    free_session(session) {
        if(session.local_rtp_port) {
            const rtp_port = session.rtp_session.get_info().local_port

            if(rtp_port) {
                this.free_rtp_ports.push(rtp_port)
            }

            session.rtp_session.close()

            log(__line, 'debug', session.uuid, `deallocated rtp port ${rtp_port}`)
        }

        if(session.mrcp_socket) {
            session.mrcp_socket.close()
            log(__line, 'debug', session.uuid, `closed mrcp socket`)
        }

        delete this.sessions[session.uuid]
        log(__line, 'debug', session.uuid, `session removed`)
    }

    process_incoming_call(uuid, req, new_session_callback) {
        log(__line, 'debug', uuid, 'new call')

        if(!req.content || req.content == '') {
            const rs = 400
            const rr = 'No SDP (Delayed Media Not Acceptable)'
            this.sip_stack.send(sip.makeResponse(req, rs, rr))
            log(__line, 'info', uuid, `${req.method} refused with ${rs} ${rr}`)
            return
        }

        const sdp_data = {}

        const offer_sdp = mrcp_utils.parse_sdp(req.content)

        if(!mrcp_utils.offer_sdp_matcher(offer_sdp, sdp_data)) {
            const rs = 400
            const rr = 'Invalid SDP For Speech Service'
            state.sip_stack.send(sip.makeResponse(req, rs, rr))
            log(__line, 'info', uuid, `refused with ${rs} ${rr}`)
            return
        }
     
        if(sdp_data.rtp_payloads.length == 0) {
            const rs = 400
            const rr = 'Invalid SDP. No payload offered'
            state.sip_stack.send(sip.makeResponse(req, rs, rr))
            log(__line, 'info', uuid, `refused with ${rs} ${rr}`)
            return
        }

        const local_rtp_port = this.free_rtp_ports.shift()

        if(local_rtp_port == undefined) {
            const rs = 500
            const rr = 'No RTP Port Available'
            state.sip_stack.send(sip.makeResponse(req, rs, rr))
            log(__line, 'info', uuid, `${req.method} refused with ${rs} ${rr}`)
            return
        }

        log(__line, 'debug', uuid, `allocated rtp port ${local_rtp_port}`)

        const data = {
            sip_session: req,
            sip_stack: this.sip_stack,
            local_rtp_ip: this.rtp_options.local_ip,
            local_rtp_port: local_rtp_port,
            direction: 'in',
            sdp_data: sdp_data,
        }

        const session = this.add_new_session(uuid, data)

        const rs = 100
        const rr = 'Trying'
        this.sip_stack.send(sip.makeResponse(req, rs, rr))
        log(__line, 'debug', uuid, `${req.method} accepted with ${rs} ${rr}`)

        new_session_callback(session)
    }

    process_in_dialog_request(uuid, req) {
        if(req.method == 'ACK') {
            // nothing to do
            return
        }

        if(req.method != 'INVITE' && req.method != 'BYE') {
            const rs = 200
            const rr = 'OK'
            const res = sip.makeResponse(req, rs, rr)
            log(__line, 'debug', uuid, `unexpected in-dialog ${req.method}. Sending default ${rs} ${rr} reply`)
            this.sip_stack.send(res)
            return
        }

        if(req.method == 'BYE') {
            log(__line, 'debug', uuid, 'received BYE')

            const rs = 200
            const rr = 'OK'
            const res = sip.makeResponse(req, rs, rr)
            this.sip_stack.send(res)

            log(__line, 'debug', uuid, `replied BYE with ${rs} ${rr}`)

            var session = this.sessions[uuid]

            if(!session) {
                log(__line, 'error', uuid, `received BYE but session was not found`)
                return
            }

            free_session(session)
            return
        }

        log(__line, 'error', uuid, "REINVITE SUPPORT IMPLEMENTATION PENDING. APP WILL EXIT")
        process.exit(1)
    }

    constructor(sip_options, rtp_options, mrcp_options, new_session_callback) {
        // sip_options: same as here https://github.com/kirm/sip.js/blob/master/doc/api.markdown
        // rtp_options: {local_ip, ports}
        // mrcp_options: {local_port: YYYY}


        this.sip_options = sip_options
        this.rtp_options = rtp_options
        this.mrcp_options = mrcp_options

        this.sessions = {}

        this.free_rtp_ports = new Deque()
        for(var i=0 ; i< rtp_options.ports.length ; i++) {
            this.free_rtp_ports.push(i)
        }

        this.sip_stack = sip.create(
            sip_options,
            req => {
                try {
                    const uuid = req.headers['call-id']
                    log(__line, 'debug', uuid, `got SIP request ${req.method}`)
                    const to_tag = req.headers['to'].params.tag

                    if(req.method == 'CANCEL') {
                        const rs = 200
                        const rr = 'OK'
                        const res = sip.makeResponse(req, rs, rr)
                        this.sip_stack.send(res)

                        log(__line, 'debug', uuid, `Sending ${rs} ${rr} reply`)

                        const session = this.sessions[uuid]

                        if(!session) return

                        rs = 487
                        rr = 'Request Terminated'
                        res = sip.makeResponse(session.sip_session, rs, rr)
                        log(__line, 'debug', uuid, `refused with ${rs} ${rr} due to CANCEL`)
                        this.sip_stack.send(res)

                        this.free_session(session)

                        return
                    }

                    if(to_tag) {
                        this.process_in_dialog_request(uuid, req)
                        return
                    }

                    if(new_session_callback) {
                        this.process_incoming_call(uuid, req, new_session_callback)
                        return
                    }

                    // new_session_callback was not set so we don't accept incoming calls
                    const rs = 403
                    const rr = 'Forbidden'
                    const res = sip.makeResponse(req, rs, rr)
                    this.sip_stack.send(res)
                    log(__line, 'debug', uuid, `$[req.method} refused with ${rs} ${rr}`)

                } catch(error) {
                    log(__line, 'error', 'sip_server', error)
                }
        })
    }
 
    create_session(sip_uri, resource_type, offer_payloads, new_session_callback) {
        const uuid = uuid_v4()

        const local_rtp_port = this.free_rtp_ports.shift()

        if(local_rtp_port == undefined) {
            const error = `No free rtp port to create new session`
            log(__line, 'info', uuid, error)
        
            new_session_callback(error)
            return
        }

        this.sip_stack.send(
            {
                method: 'INVITE',
                uri: sip_uri,
                headers: {
                    to: {uri: sip_uri},
                    from: {uri: `sip:mrcp_client@${this.sip_options.address}:${this.sip_options.port}`, params: {tag: rstring()}},
                    'call-id': uuid,
                    cseq: {method: 'INVITE', seq: Math.floor(Math.random() * 1e5)},
                    'content-type': 'application/sdp',
                    contact: [{uri: `sip:mrcp_client@${this.sip_options.address}:${this.sip_options.port}`}],
                },
                content: mrcp_utils.gen_offer_sdp(resource_type, this.rtp_options.local_ip, local_rtp_port, offer_payloads),
            },
            rs => {
                console.log(rs)

                if(rs.status >= 300) {
                    const error = `call failed with status ${rs.status} ${rs.reason}`

                    log(__line, 'info', uuid, error)
                
                    new_session_callback(error)
                    return
                } else if(rs.status < 200) {
                    log(__line, 'info', uuid, `call progress status ${rs.status} ${rs.reason}`)
                } else {
                    // yes we can get multiple 2xx response with different tags
                    log(__line, 'info', uuid, `call answered with tag ${rs.headers.to.params.tag}`)

                    // sending ACK
                    sip_stack.send({
                        method: 'ACK',
                        uri: rs.headers.contact[0].uri,
                        headers: {
                            to: rs.headers.to,
                            from: rs.headers.from,
                            'call-id': uuid,
                            cseq: {method: 'ACK', seq: rs.headers.cseq.seq},
                            via: []
                        }
                    })

                    const sdp_data = {}

                    try {
                        const answer_sdp = mrcp_utils.parse_sdp(rs.content)
                        if(!mrcp_utils.answer_sdp_matcher(answer_sdp, sdp_data)) {
                            const error = `invalid answer SDP`

                            log(__line, 'info', uuid, error)
                        
                            new_session_callback(error)
                            return
                        }

                        const data = {
                            sip_session: rs,
                            sip_stack: this.sip_stack,
                            local_rtp_ip: this.rtp_options.local_ip,
                            local_rtp_port: local_rtp_port,
                            direction: 'out',
                            sdp_data: sdp_data,
                        }

                        const session = this.add_new_session(uuid, data)

                        new_session_callback(null, session)
                    } catch(error) {
                        log(__line, 'error', error)
                        new_session_callback(error)
                    }
                }
            }
        )
    }
}

module.exports = SipMrcp
