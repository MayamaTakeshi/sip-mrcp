const z = require('zester')
const m = z.matching
const util = require('util')

const mrcp = require('mrcp')

const SipMrcp = require('../index.js')

const sm1 = new SipMrcp({
        address: '127.0.0.1',
        port: 8091,
        publicAddress: '127.0.0.1',

        logger: {
            send: function(rq) {
                return util.debuglog("send\n" + util.inspect(rq, null, null))
            },
            recv: function(rq) {
                return util.debuglog("recv\n" + util.inspect(rq, null, null))
            }
        },
    },
    {
        local_ip: '127.0.0.1',
        ports: [10000],
    },
    {
        local_port: '9001',
    },
    new_session => {
        console.log(`sm1 new session ${new_session}`)
        new_session.accept(0)
})

const sm2 = new SipMrcp({
        address: '127.0.0.1',
        port: 8092,
        publicAddress: '127.0.0.1',
    },
    {
        local_ip: '127.0.0.1',
        ports: [10002],
    },
    {
        local_port: '9002',
    },
    new_session => {
        console.log(`sm2 new session ${new_session}`)
        //new_session.refuse()
        new_session.accept(0)

        new_session.on('mrcp_msg', msg => {
            console.log(`sm2 got ${JSON.stringify(msg)}`)
            const response = mrcp.builder.build_response(msg.request_id, 200, 'COMPLETE', {'channel-identifier': new_session.data.mrcp_uuid, 'Completion-Cause': '000 success'})
            new_session.send_mrcp_msg(response)
        })

})


const sip_uri = "sip:sm2@127.0.0.1:8092"
const resource_type = "speechsynth"
const offer_payloads = [0]
sm1.create_session(sip_uri, resource_type, offer_payloads, (err, new_session) => {
    if(err) {
        console.log(`error: ${err}`)
        return
    }

    console.log("sm1 was accepted by sm2")

    new_session.on('mrcp_msg', msg => {
        console.log("sm1 got mrcp_msg", msg)
    })

    new_session.on('error', err => {
        console.log("sm1 got error", msg)
    })

    const request_id = 1
    const content_id = 'some-content-123'
    const grammar = "<test/>"
    const define_grammar_msg = mrcp.builder.build_request('DEFINE-GRAMMAR', request_id, {
        'channel-identifier': new_session.data.mrcp_uuid,
        'content-id': content_id,
        'content-type': 'application/xml',
    }, grammar)

    new_session.send_mrcp_msg(define_grammar_msg)
})


