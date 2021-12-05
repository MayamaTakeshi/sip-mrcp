const sip_mrcp = require('../index.js')

const mrcp = require('mrcp')
const log = require('tracing-log')

const client = new sip_mrcp.SipMrcpStack({
    sip_options: { // see available options at https://github.com/kirm/sip.js/blob/master/doc/api.markdown
        address: '127.0.0.1',
        port: 8091,
        publicAddress: '127.0.0.1',
    },
    rtp_options: {
        local_ip: '127.0.0.1',
        local_ports: [10000], // list of RTP ports to be used by the stack
    },
    mrcp_options:{
        local_port: '9001',
    }
})

const sip_uri = "sip:sm2@127.0.0.1:8092"
const resource_type = "speechsynth"

const offer_payloads = [
    {
        id: 0,
        codec_name: 'PCMU',
        clock_rate: 8000,
    }
]

client.create_session(sip_uri, resource_type, offer_payloads, (error, new_session) => {
    if(error) {
        log.error(error)
        process.exit(1)
    }

    log.info("new_session created")
    console.dir(new_session)

    const request_id = 1
    const method = 'SPEAK'
    const body = "hello world"
    const content_type = 'text/plain'

    const msg = mrcp.builder.build_request(method, request_id, {
        'channel-identifier': new_session.data.mrcp_uuid,
        'content-type': content_type,
    }, body)
    new_session.send_mrcp_msg(msg)

    var rtp_count = 0

    new_session.on('mrcp_msg', msg => {
        log.info(JSON.stringify(msg))

        if(msg.type == 'response' && msg.request_id == request_id && msg.status_code == 200) {
            log.info(`${method} got ${msg.status_code}`)
        } else if(msg.type == 'event' && msg.event_name == 'SPEAK-COMPLETE') {
            if(rtp_count != 5) {
                log.error(`Didn't get all RTP data: expected 5, received ${rtp_count}`)
                process.exit(1)
            }
            log.info('success')
            new_session.terminate()
            setTimeout(() => {
                process.exit(0)
            }, 200)
        } else {
            log.error("Unexpected mrcp_msg")
            process.exit(1)
        }
    })

    new_session.on('rtp_data', data => {
        log.info('Received rtp_data')
        rtp_count++
    })
})

