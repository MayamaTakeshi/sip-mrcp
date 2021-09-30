const sip = require('sip')
const _ = require('lodash')
const mrcp = require('mrcp')
const mrcp_utils = require('mrcp-utils')
const uuid = require('uuid')
const RtpSession = require('rtp-session')

/*
const resource_type = 'speechsynth'
const call_id = uuid.v4()

rtp_session.on('error', (err) => {
    console.error(err)
    terminate(1)
})
*/

function start(sip_options, mrcp_options, new_session_callback) {
    // sip_options: same as here https://github.com/kirm/sip.js/blob/master/doc/api.markdown
    // mrcp_options: {local_ip: 'XXXXX', local_port: YYYY}

    const sessions = {}
     
    const sip_stack = sip.create(sip_options,
        (req) => {
            if(req['call-id'] != call_id) {
                console.log(`Received non-dialog ${req.method}`)
                sip_stack.send(sip.makeResponse(req, 481, "Call Leg/Transaction Does Not Exist"))
                return
            }

            if(req.method == 'BYE') {
                console.log('Got BYE')
                var res = sip.makeResponse(req, 200, 'OK')
                sip_stack.send(res)
                terminate(0)

                return
            }

            sip_stack.send(sip.makeResponse(req, 405, "Method not allowed"))
        }
    )
   
}


const sip_uri = `sip:${server_sip_host}:${server_sip_port}`

sip_stack.send(
    {
        method: 'INVITE',
        uri: sip_uri,
        headers: {
            to: {uri: sip_uri},
            from: {uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`, params: {tag: utils.rstring()}},
            'call-id': call_id,
            cseq: {method: 'INVITE', seq: Math.floor(Math.random() * 1e5)},
            'content-type': 'application/sdp',
            contact: [{uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`}],
        },
        content: mrcp_utils.gen_offer_sdp(resource_type, local_ip, local_rtp_port),
    },
    function(rs) {
        console.log(rs)

        if(rs.status >= 300) {
            console.log('call failed with status ' + rs.status)  
        }
        else if(rs.status < 200) {
            console.log('call progress status ' + rs.status)
        } else {
            // yes we can get multiple 2xx response with different tags
            console.log('call answered with tag ' + rs.headers.to.params.tag)

            // sending ACK
            sip_stack.send({
                method: 'ACK',
                uri: rs.headers.contact[0].uri,
                headers: {
                    to: rs.headers.to,
                    from: rs.headers.from,
                    'call-id': call_id,
                    cseq: {method: 'ACK', seq: rs.headers.cseq.seq},
                    via: []
                }
            })

            var data = {}

            try {
                var answer_sdp = mrcp_utils.parse_sdp(rs.content)
                console.log(answer_sdp)
                if(!mrcp_utils.answer_sdp_matcher(answer_sdp, data)) {
                    console.error("Could not get correct SDP answer")
                    terminate(1)
                }

                rtp_session.set_remote_end_point(data.remote_ip, data.remote_rtp_port)

                rtp_session.on('data', payload => {
                    //console.log('rtp packet')

                    var buf = Buffer.alloc(payload.length * 2)

                    for(var i=0 ; i<payload.length ; i++) {
                        // convert ulaw to L16 little-endian
                        var l = lu.ulaw2linear(payload[i])
                        buf[i*2] = l & 0xFF
                        buf[i*2+1] = l >>> 8
                    }

                    if(speaker) {
                        buffer.push(buf)

                        var res = buffer.shift()

                        while(res) {
                            speaker.write(res)
                            res = buffer.shift()
                        }
                    }

                    if(output_file) {
                        output_file.write(buf)
                    }
                })

                var client = mrcp.createClient({
                    host: data.remote_ip,
                    port: data.remote_mrcp_port,
                })

                var request_id = 1

                var msg = mrcp.builder.build_request('SPEAK', request_id, {
                    'channel-identifier': data.channel,
                    'speech-language': language,
		            'content-type': args.text.indexOf('<speak>') >= 0 ? 'application/ssml+xml' : 'text/plain',
                }, args.text)
                console.log('Sending MRCP requests. result: ', client.write(msg))
                request_id++

                client.on('error', (err) => {
                    console.error(err)
                    terminate(1)
                })

                client.on('close', () => { console.log('mrcp client closed') })

                client.on('data', data => {
                    console.log('***********************************************')
                    console.log('mrcp on data:')
                    console.log(data)
                    console.log()

                    if (data.type == 'response' && data.status_code == 200) {
                        console.log("command accepted")

                        // Simulating client disconnection during speak
                        /*
                        setTimeout(() => {
                            sip_stack.send({
                                method: 'BYE',
                                uri: rs.headers.contact[0].uri,
                                headers: {
                                    to: rs.headers.to,
                                    from: rs.headers.from,
                                    'call-id': call_id,
                                    cseq: {method: 'BYE', seq: rs.headers.cseq.seq + 1},
                                    via: []
                                }
                            }, (res) => {
                                    console.log(`BYE got: ${res.status} ${res.reason}`)    
                                    terminate(0)
                            })
                        }, 500)
                        */
                    } else if (data.type == 'event' && data.event_name == 'SPEAK-COMPLETE') {
                        // sending BYE
                        setTimeout(() => {
                            sip_stack.send({
                                method: 'BYE',
                                uri: rs.headers.contact[0].uri,
                                headers: {
                                    to: rs.headers.to,
                                    from: rs.headers.from,
                                    'call-id': call_id,
                                    cseq: {method: 'BYE', seq: rs.headers.cseq.seq + 1},
                                    via: []
                                }
                            }, (res) => {
                                    console.log(`BYE got: ${res.status} ${res.reason}`)    
                                    terminate(0)
                            })
                        }, 500)
                    } else {
                        console.log("unexpected data")
                        console.dir(data)
                    }

                })
            } catch(e) {
                console.error(`Failure when process answer SDP: ${e}`)
                terminate(1)
            }
        }
    }
)
