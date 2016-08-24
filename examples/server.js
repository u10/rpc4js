var path = require('path')
var http = require('http')
var express = require('express')
var rpc4js = require('../dist/rpc4js')
var socketIo = require('socket.io')
var rest = express()
var server = http.createServer(rest)
var ws = socketIo.listen(server)

rpc4js
    .define('test', function (client) {
        return {
            a: 'a',
            func: function (msg) {
                console.log(this.a)
                console.log(msg)
                client.FUNC('echo ' + msg)
                if (msg === 'error') {
                    throw new Error('this is a err test')
                }
                return msg
            },
            func_with_callback: function (cb001, f2) {
                cb001(function (cb003) {
                    cb003('this is a msg from inner callback.')
                })
                f2('this is a msg from server.').fail(function (res) {
                    console.log('error: ' + res.error.message)
                })
            }
        }
    })
    .listen(ws)

function njs(module) {
    var dir = path.join(__dirname, '..', 'node_modules', module)
    var info = require(path.join(dir, 'package.json'))
    var main = info.jspm && info.jspm.main || info.main
    if (!/.js$/i.test(main)) {
        main = main + '.js'
    }
    return express.static(path.join(dir, main))
}

rest.use('/', express.static(__dirname))
rest.use('/rpc4js.js', express.static(path.join(__dirname, '..', 'dist', 'rpc4js.js')))
rest.use('/lodash.js', njs('lodash'))
rest.use('/node-uuid.js', njs('node-uuid'))
rest.use('/q.js', njs('q'))
rest.use('/socket.io-client.js', njs('socket.io-client'))

var port = 3010
var address = '0.0.0.0'
server.listen(port, address, function () {
    console.log('(' + address + ':' + port + ')...')
})