//require('magic-globals')

const sip = require('sip')
const _ = require('lodash')
const mrcp = require('mrcp')
const mrcp_utils = require('mrcp-utils')
const uuid_v4 = require('uuid').v4
const Deque = require('collections/deque')

const Session = require('./session.js')

const logger = require('./logger.js')

const utils = require('./utils.js')

const FILE = "stack.js"
const __line = "????"

const log = (line, level, entity, msg) => {
    logger.log(level, entity, `(${FILE}:${line}) ${msg}`)
}

const rstring = () => {
    return Math.floor(Math.random()*1e6).toString()
}


var get_transport = (uri) => {
    var arr = uri.split(";")
    for(var i=0 ; i<arr.length ; i++) {
        var item = arr[i]
        if(item.indexOf(item, "=") < 0) continue

        var key_val = item.split("=")
        var key = key_val[0]
        var val = key_val[1]
        if(key.toLowerCase() == "transport") {
            return val
        }
    } 
    return "udp"
}

class SipMrcpStack {
    _create_sip_stack(sip_options, new_session_callback) {
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

    _create_mrcp_server(mrcp_options) {
        this.mrcp_server = mrcp.createServer(conn => {
            conn.once('data', data => {
                // need to wait for the first message to get channel-identifier
                log(__line, 'debug', 'mrcp_server', `got MRCP message ${JSON.stringify(data)}`)
                const mrcp_uuid = data.headers['channel-identifier']

                if(!this.mrcp2sip.hasOwnProperty(mrcp_uuid)) {
                    log(__line, 'warning', mrcp_uuid, `got unexpected MRCP message ${data} for unknown mrcp_uuid`)
                    const response = mrcp.builder.build_response(data.request_id, 405, 'COMPLETE', {'channel-identifier': mrcp_uuid})
                    utils.safe_write(conn, response)
                    conn.close()
                    return
                }

                const uuid = this.mrcp2sip[mrcp_uuid]

                const session = this.sessions[uuid]
                if(!session) {
                    // if we reach here, it probably indicates a bug
                    log(__line, 'error', mrcp_uuid, `unexpected MRCP request for non existing session ${uuid} ${JSON.stringify(data)}`)
                    const response = mrcp.builder.build_response(data.request_id, 405, 'COMPLETE', {'channel-identifier': mrcp_uuid})
                    utils.safe_write(conn, response)
                    conn.close()
                    return
                }

                session.mrcp_socket = conn
                session.emit('mrcp_msg', data)

                conn.on('data', data => {
                    session.emit('mrcp_msg', data)
                })
            })

            conn.on('error', err => {
                log(__line, 'error', 'mrcp_server', `conn error: ${err}. App will terminate.`)
                session.emit('error', err)
                this.free_session(session)
            })
        })

        this.mrcp_server.listen(this.mrcp_options.local_port, this.mrcp_options.local_ip)
        this.mrcp_server.on('error', err => {
                log(__line, 'error', 'mrcp_server', err)
                process.exit(1)
        })
    }

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

        if(session.data.mrcp_uuid) {
            delete this.mrcp2sip[session.data.mrcp_uuid]
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
            sm_stack: this,
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
        // rtp_options: {local_ip, local_ports}
        // mrcp_options: {local_port: YYYY}

        this.sip_options = sip_options
        this.rtp_options = rtp_options
        this.mrcp_options = mrcp_options

        this.sessions = {}
        this.mrcp2sip = {}

        this.free_rtp_ports = new Deque(rtp_options.local_ports)

        try {
            this._create_sip_stack(sip_options, new_session_callback)

            if(new_session_callback) {
                mrcp_options.local_ip = sip_options.address
                this._create_mrcp_server(mrcp_options)
            }
        } catch(error) {
            log(__line, 'error', 'sip_mrcp.constructor', `error: ${error}`)
            process.exit(1) 
        }
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

        log(__line, 'debug', uuid, `allocated rtp port ${local_rtp_port}`)

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
                //console.log(rs)

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

                    try {
                        // sending ACK
                        this.sip_stack.send({
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

                        const answer_sdp = mrcp_utils.parse_sdp(rs.content)
                        if(!mrcp_utils.answer_sdp_matcher(answer_sdp, sdp_data)) {
                            const error = `invalid answer SDP`

                            log(__line, 'info', uuid, error)
                        
                            new_session_callback(error)
                            return
                        }

                        const data = {
                            sip_session: rs,
                            sm_stack: this,
                            local_rtp_ip: this.rtp_options.local_ip,
                            local_rtp_port: local_rtp_port,
                            direction: 'out',
                            sdp_data: sdp_data,
                            mrcp_uuid: sdp_data.channel,
                        }

                        const session = this.add_new_session(uuid, data)
                        this.mrcp2sip[sdp_data.channel] = uuid

                        const mrcp_socket = mrcp.createClient({
                            host: sdp_data.remote_ip,
                            port: sdp_data.remote_mrcp_port,
                        })

                        session.mrcp_socket = mrcp_socket

                        mrcp_socket.on('error', (err) => {
                            session.emit('error', err)
                            this.free_session(session)
                        })

                        mrcp_socket.on('data', data => {
                            session.emit('mrcp_msg', data)
                        })

                        new_session_callback(null, session)
                    } catch(error) {
                        log(__line, 'error', error)
                        new_session_callback(error)
                    }
                }
            }
        )
    }

    accept(session) {
        const mrcp_uuid = `${session.uuid}@${session.data.sdp_data.resource}`
        const answer_sdp = mrcp_utils.gen_answer_sdp(this.rtp_options.local_ip, this.mrcp_options.local_port, session.data.local_rtp_port, session.data.sdp_data.connection, mrcp_uuid, session.data.sdp_data.resource)

        const rs = 200
        const rr = 'OK'
        const res = sip.makeResponse(session.data.sip_session, rs, rr)

        res.headers.to.params.tag = rstring()

        const req = session.data.sip_session

        const transport = get_transport(req.uri)

        res.headers['record-route'] = req.headers['record-route']
        res.headers.contact = [{uri: `sip:mrcp_server@${this.sip_options.address}:${this.sip_options.port}`, params: {transport: transport}}]
        res.headers['content-type'] = 'application/sdp'
        res.content = answer_sdp

        session.data.sip_session = res
        session.data.mrcp_uuid = mrcp_uuid

        this.mrcp2sip[mrcp_uuid] = session.uuid

        this.sip_stack.send(res,
            function(res) {
                log(__line, 'info', session.uuid, 'got callback to res sent to out-of-dialog INVITE on sip stack')
            }
        )

        log(__line, 'debug', session.uuid, `INVITE accepted with ${rs} ${rr} by app layer`)
    }

    refuse(session, response_status, response_reason) {
        this.sip_stack.send(sip.makeResponse(session.sip_session, rs, rr))
        log(__line, 'debug', session.uuid, `INVITE refused with ${rs} ${rr} by app layer`)

        free_session(session)
    }
}

module.exports = SipMrcpStack
