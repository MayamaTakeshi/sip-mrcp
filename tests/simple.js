const sip_mrcp = require('../index.js')

const assert = require('assert')

const mrcp = require('mrcp')
const log = require('tracing-log')

const m = require('data-matching')

const Zeq = require('@mayama/zeq')

const z = new Zeq()

async function test() {
    const sm1 = new sip_mrcp.SipMrcpStack({
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

    const sm2 = new sip_mrcp.SipMrcpStack({
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
        new_session_callback: z.callback_trap('sm2_new_session')
    })

    const sip_uri = "sip:sm2@127.0.0.1:8092"
    const resource_type = "speechrecog"

    const offer_payloads = [
        {
            id: 0,
            codec_name: 'PCMU',
            clock_rate: 8000,
        },
        {
            id: 8,
            codec_name: 'PCMA',
            clock_rate: 8000,
        },
        {
            id: 3,
            codec_name: 'GSM',
            clock_rate: 8000,
        },
   ]

    sm1.create_session(sip_uri, resource_type, offer_payloads, z.callback_trap("sm1_new_session"))

    await z.wait([
        {
            source: 'callback',
            name: 'sm2_new_session',
            args: [m.collect('sm2_session')],
        },
    ], 1000)

    const sm2_session = z.store.sm2_session

    z.trap_events(sm2_session, 'sm2_session')

    sm2_session.accept(offer_payloads[0])

    await z.wait([
        {
            source: 'callback',
            name: 'sm1_new_session',
            args: [
                null, // it means no error
                m.collect("sm1_session"),
            ],
        },
    ], 1000)

    const sm1_session = z.store.sm1_session

    // once the session is established, the session.payload_type will be set
    assert(sm1_session.payload_type == 0)

    z.trap_events(sm1_session, 'sm1_session')

    const request_id = 1
    const method = 'DEFINE-GRAMMAR'
    const content_id = 'some-content-123'
    const grammar = "<test/>"
    const content_type = 'application/xml'

    const define_grammar_msg = mrcp.builder.build_request(method, request_id, {
        'channel-identifier': sm1_session.data.mrcp_uuid,
        'content-id': content_id,
        'content-type': content_type,
    }, grammar)

    sm1_session.send_mrcp_msg(define_grammar_msg)

    await z.wait([
        {
            source: 'sm2_session',
            name: 'mrcp_msg',
            args: [
                {
                    type: 'request',
                    version: '2.0',
                    method: method,
                    request_id: request_id,
                    headers: {
                        'channel-identifier': sm1_session.data.mrcp_uuid,
                        'content-id': content_id,
                        'content-type': content_type,
                        'content-length': grammar.length.toString(),
                    },
                    body: grammar,
                },
            ]
        },
    ], 1000)

    const response = mrcp.builder.build_response(request_id, 200, 'COMPLETE', {'channel-identifier': sm1_session.data.mrcp_uuid, 'Completion-Cause': '000 success'})
    sm2_session.send_mrcp_msg(response)

    await z.wait([
        {
            source: 'sm1_session',
            name: 'mrcp_msg',
            args: [
                {
                    type: 'response',
                    version: '2.0',
                    request_id: request_id,
                    status_code: 200,
                    request_state: 'COMPLETE',
                    headers: {
                        'channel-identifier': sm1_session.data.mrcp_uuid,
                        'completion-cause': '000 success'
                    }
                }
            ]
        },
    ], 1000)

    const data = Buffer.alloc(10)
    const marker_bit = 0
    sm1_session.send_rtp_data(data, marker_bit)

    await z.wait([
        {
            source: 'sm2_session',
            name: 'rtp_data',
            args: [
                {
                    0: 0,
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0,
                    5: 0,
                    6: 0,
                    7: 0,
                    8: 0,
                    9: 0
                },
            ]
       },
    ], 1000)

    sm1_session.terminate()

    await z.sleep(100)

    log.info("Success")
    process.exit(0)
}

test()
.catch(e => {
    log.error(e)
    log.error(e.stack)
    process.exit(1)
})


