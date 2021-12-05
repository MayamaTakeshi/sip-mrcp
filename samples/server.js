const sip_mrcp = require('../index.js')

const mrcp = require('mrcp')
const log = require('tracing-log')

const server = new sip_mrcp.SipMrcpStack({
    sip_options: { // see available options at https://github.com/kirm/sip.js/blob/master/doc/api.markdown
        address: '127.0.0.1',
        port: 8092,
        publicAddress: '127.0.0.1',
    },
    rtp_options: {
        local_ip: '127.0.0.1',
        local_ports: [10002],
    },
    mrcp_options: {
        local_port: '9002',
    },
    new_session_callback: new_session => {
        const pcmu = 0

        new_session.accept(pcmu)

        new_session.on('mrcp_msg', msg => {
            if(msg.type == 'request' && msg.method == 'SPEAK') {
                const response = mrcp.builder.build_response(msg.request_id, 200, 'IN-PROGRESS', {
                    'channel-identifier': new_session.data.mrcp_uuid,
                    'speech-Mmrker': 'timestamp=857206027059'
                })
                new_session.send_mrcp_msg(response)

                const data = Buffer.alloc(10)
                const marker_bit = 0
                for(var i=0 ; i<5 ; i++) {
                    new_session.send_rtp_data(data, marker_bit)
                }

                setTimeout(() => {
                    const event = mrcp.builder.build_event('SPEAK-COMPLETE', msg.request_id, 'COMPLETE', {
                        'channel-identifier': new_session.data.mrcp_uuid,
                        'completion-cause': '000 normal',
                        'speech-marker': 'timestamp=857206027059',
                    })
                    new_session.send_mrcp_msg(event)
                }, 200)
            }
        })
    },
})
