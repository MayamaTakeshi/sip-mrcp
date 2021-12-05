# sip-mrcp
A nodejs SIP/MRCP module that permits to implement MRCPv2 client/server apps.

## installation
```
npm install sip-mrcp
```

## Usage
```
const sip_mrcp = require('sip-mrcp')
const mrcp = require('mrcp')

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
        // accept or refuse the session
        new_session.accept(0)
        // new_session.refuse(404, 'Not Found')

        // on a session you can wait for mrcp_msg and rtp_data:

        new_session.on('mrcp_msg', msg => { // do something }

        new_session.on('rtp_data', msg => { // do something }
    },
})

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

const pcmu = 0
const offer_payloads = [pcmu]

client.create_session(sip_uri, resource_type, offer_payloads, (error, new_session) => {
    if(error) {
        console.error(error)
        process.exit(1)
    }

    console.info("new_session created")

    // once you have a session, you can send MRCP requests

    new_session.send_mrcp_msg(SOME_MRCP_MESSAGE)

    // and handle MRCP msgs and RTP data

    new_session.on('mrcp_msg', msg => { // do something }

    new_session.on('rtp_data', msg => { // do something }
})


```
See samples/server.js and samples/client.js. 

They were written to interact with each other.

You can test by cloning the repo and doing:
```
npm install
```

Then start them on separate shells:
```
node samples/server.js
```
```
node samples/client.js
```

