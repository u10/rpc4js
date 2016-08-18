import _ from 'lodash'
import Q from 'q'
import uuid from 'node-uuid'

const slice = [].slice
const localConstructors = {}

function mapping(obj, funcIndex, funcMap, opts, path, context) {
    path = path || []
    if (_.isFunction(obj)) {
        const id = uuid.v4()
        if (opts && opts.clear) {
            opts.clear.push(id)
        }
        funcMap[id] = (function (context) {
            return function () {
                let rpc = _.extend({}, opts, {clear: false})
                let args = 1 <= arguments.length ? slice.call(arguments, 0) : []
                const result = obj.apply(context, [rpc].concat(args))
                if (rpc.clear) {
                    if (opts.clear) {
                        for (let v of opts.clear) {
                            delete funcMap[v]
                        }
                    }
                } else {
                    if (rpc.release) {
                        delete funcMap[id]
                    }
                }
                return result
            }
        })(context)
        funcIndex.push(path.concat([id]))
        return 0
    } else if (_.isArray(obj)) {
        const val = []
        for (let i = 0, len = obj.length; i < len; i++) {
            path.push(i)
            val.push(mapping(obj[i], funcIndex, funcMap, opts, path))
            path.pop()
        }
        return val
    } else if (_.isObject(obj)) {
        const val = {}
        for (let k in obj) {
            path.push(k)
            val[k] = mapping(obj[k], funcIndex, funcMap, opts, path, obj)
            path.pop()
        }
        return val
    } else {
        return obj
    }
}

function proxy(ws, obj, funcIndex, funcMap) {
    var method, o, v
    for (let i = 0, m = funcIndex.length; i < m; i++) {
        v = funcIndex[i]
        o = obj
        for (let j = 0, n = v.length - 2; j < n; j++) {
            o = o[v[j]]
        }
        method = v[v.length - 1]
        o[v[v.length - 2]] = (function (method) {
            return function () {
                let args = 1 <= arguments.length ? slice.call(arguments, 0) : []
                const deferred = Q.defer()
                const funcIndex = []
                const id = uuid.v4()
                args = mapping(args, funcIndex, funcMap, {release: true, clear: []})
                ws.emit('rpc-call', {
                    id: id,
                    method: method,
                    args: args,
                    funcIndex: funcIndex
                })
                const timer = setTimeout(function () {
                    ws.removeListener('rpc-return', callback)
                    deferred.reject()
                }, 5000)
                const callback = function (res) {
                    if (res.id === id) {
                        clearTimeout(timer)
                        ws.removeListener('rpc-return', callback)
                        if (res.error) {
                            deferred.reject(res.error)
                        } else {
                            deferred.resolve(res.result)
                        }
                    }
                }
                ws.on('rpc-return', callback)
                return deferred.promise
            }
        })(method)
    }
    return obj
}

function mkRpcCallCallback(ws, funcMap) {
    return function (req) {
        const func = funcMap[req.method]
        if (func) {
            const argsProxy = proxy(ws, req.args, req.funcIndex, funcMap)
            const result = func.apply(null, argsProxy)
            ws.emit('rpc-return', {
                id: req.id,
                result: result
            })
        } else {
            ws.emit('rpc-return', {
                id: req.id,
                error: 'function not found'
            })
        }
    }
}

export default {
    define: function (name, constructor) {
        localConstructors[name] = constructor
        return this
    },
    listen: function (ws) {
        this.ws = ws
        ws.on('connect', function (socket) {
            let funcMap = {}
            let funcIndex = []
            socket.on('rpc-connect', function (req) {
                const clientProxy = proxy(socket, req.client, req.funcIndex, funcMap)
                let local = localConstructors[req.name](clientProxy)
                local = mapping(local, funcIndex, funcMap)
                socket.on('rpc-call', mkRpcCallCallback(socket, funcMap))
                socket.emit('rpc-connect', {
                    name: req.name,
                    remote: local,
                    funcIndex: funcIndex
                })
            }).on('disconnect', function () {
                funcMap = undefined
                funcIndex = undefined
            })
        })
    },
    bind: function (ws) {
        this.ws = ws
        return this
    },
    connect: function (name, local, callback) {
        const ws = this.ws
        const funcMap = {}
        const funcIndex = []
        const client = mapping(local, funcIndex, funcMap)
        ws.emit('rpc-connect', {
            name: name,
            client: client,
            funcIndex: funcIndex
        })
        const rpcConnectCallback = function (res) {
            var remoteProxy
            if (res.name === name) {
                ws.removeListener('rpc-connect', rpcConnectCallback)
                ws.on('rpc-call', mkRpcCallCallback(ws, funcMap))
                remoteProxy = proxy(ws, res.remote, res.funcIndex, funcMap)
                callback(remoteProxy)
            }
        }
        ws.on('rpc-connect', rpcConnectCallback)
    },
    destroy: function () {
        var ws
        ws = this.ws
        ws.removeListener('rpc-call')
        ws.removeListener('rpc-return')
        delete this.ws
    }
}
