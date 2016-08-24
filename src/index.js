import _ from 'lodash'
import Q from 'q'
import uuid from 'node-uuid'

const slice = [].slice
const localConstructors = {}

function release(id, funcMap) {
    if (funcMap[id]) {
        for (let index in funcMap[id]) {
            delete funcMap[funcMap[id][index]]
        }
        funcMap[id] = false
        setTimeout(function () {
            delete funcMap[id]    
        },100)
    }
}

function clear(funcIndex, funcMap) {
    for (let index in funcIndex) {
        let key = funcIndex[index]
        delete funcMap[key[key.length - 1]]
    }
}

function mapping(obj, funcIndex, funcMap, options, path, context) {
    path = path || []
    if (_.isFunction(obj)) {
        const id = uuid.v4()
        if (!options.autoRelease && options.id) {
            if (options.disposed || funcMap[options.id] === false) {
                return 0
            }
            (funcMap[options.id] = funcMap[options.id] || []).push(id)
        }
        funcMap[id] = function () {
            const deferred = Q.defer()
            const args = 1 <= arguments.length ? slice.call(arguments, 0) : []
            try {
                deferred.resolve(obj.apply(context, args))
                if (options.autoRelease) {
                    delete funcMap[id]
                }
            } catch (error) {
                deferred.reject({message: error.message})
                if (options.autoRelease) {
                    funcIndex = clear(funcIndex, funcMap)
                    delete funcMap[id]
                }
            }
            return deferred.promise
        }
        funcIndex.push(path.concat([id]))
        return 0
    } else if (_.isArray(obj)) {
        const val = []
        for (let i = 0, len = obj.length; i < len; i++) {
            path.push(i)
            val.push(mapping(obj[i], funcIndex, funcMap, options, path))
            path.pop()
        }
        return val
    } else if (_.isObject(obj)) {
        const val = {}
        for (let k in obj) {
            path.push(k)
            val[k] = mapping(obj[k], funcIndex, funcMap, options, path, obj)
            path.pop()
        }
        return val
    } else {
        return obj
    }
}

function proxy(ws, obj, funcIndex, funcMap, options) {
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
                const deferred = Q.defer()
                const args = 1 <= arguments.length ? slice.call(arguments, 0) : []
                const id = uuid.v4()
                const config = _.extend({
                    timeout: 5000,
                    autoRelease: true,
                    id
                }, options)
                let funcIndex = []
                setTimeout(function () {
                    const timer = setTimeout(function () {
                        ws.removeListener('rpc-return', callback)
                        deferred.reject({message: 'timeout'})
                    }, config.timeout)
                    const callback = function (res) {
                        if (res.id === id) {
                            clearTimeout(timer)
                            ws.removeListener('rpc-return', callback)
                            if (res.error) {
                                deferred.reject(res.error)
                                if (config.autoRelease) {
                                    funcIndex = clear(funcIndex, funcMap)
                                    delete funcMap[method]
                                }
                            } else {
                                deferred.resolve(res.result)
                                if (config.autoRelease) {
                                    delete funcMap[method]
                                }
                            }
                        }
                    }
                    ws.emit('rpc-call', {
                        id: id,
                        method: method,
                        args: mapping(args, funcIndex, funcMap, config),
                        funcIndex: funcIndex,
                        options: config
                    })
                    ws.on('rpc-return', callback)
                }, 0)
                const promise = _.extend(deferred.promise, {
                    config: function (conf) {
                        _.extend(config, conf)
                        return promise
                    },
                    end: function () {
                        if (!config.autoRelease) {
                            config.disposed = true
                            release(id, funcMap)
                            ws.emit('rpc-release', {id})    
                        }
                    }
                })
                return promise
            }
        })(method)
    }
    return obj
}

function rpcCallCallbackFactory(ws, funcMap) {
    return function (req) {
        const func = funcMap[req.method]
        if (func) {
            func.apply(null, proxy(ws, req.args, req.funcIndex, funcMap, req.options))
                .then(function (result) {
                    ws.emit('rpc-return', {
                        id: req.id,
                        result: result
                    })
                })
                .fail(function (error) {
                    ws.emit('rpc-return', {
                        id: req.id,
                        error: error
                    })
                })
        } else {
            ws.emit('rpc-return', {
                id: req.id,
                error: {message: 'function not found'}
            })
        }
    }
}

function rpcReleaseCallbackFactory(funcMap) {
    return function (req) {
        release(req.id, funcMap)
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
                const constructor = localConstructors[req.name]
                if (constructor) {
                    const local = constructor(proxy(socket, req.client, req.funcIndex, funcMap))
                    socket.on('rpc-call', rpcCallCallbackFactory(socket, funcMap))
                    socket.on('rpc-release', rpcReleaseCallbackFactory(funcMap))
                    socket.emit('rpc-connect', {
                        id: req.id,
                        name: req.name,
                        remote: mapping(local, funcIndex, funcMap, req.options),
                        funcIndex: funcIndex
                    })
                } else {
                    socket.emit('rpc-connect', {
                        id: req.id,
                        name: req.name,
                        error: {message: 'object not found'}
                    })
                }

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
    connect: function (name, local, options) {
        options = _.extend({
            timeout: 5000,
            autoRelease: false
        }, options)
        const deferred = Q.defer()
        const ws = this.ws
        let funcIndex = []
        let funcMap = {}

        function release() {
            clearTimeout(timer)
            ws.removeListener('rpc-connect', rpcConnectCallback)
            funcMap = undefined
            funcIndex = undefined
        }

        const timer = setTimeout(function () {
            release()
            deferred.reject({message: 'timeout'})
        }, options.timeout)
        const id = uuid.v4()
        ws.emit('rpc-connect', {
            id: id,
            name: name,
            client: mapping(local, funcIndex, funcMap, options),
            funcIndex: funcIndex,
            options
        })
        const rpcConnectCallback = function (res) {
            if (res.id === id) {
                if (res.error) {
                    release()
                    deferred.reject(res.error)
                } else {
                    clearTimeout(timer)
                    ws.removeListener('rpc-connect', rpcConnectCallback)
                    ws.on('rpc-call', rpcCallCallbackFactory(ws, funcMap))
                    ws.on('rpc-release', rpcReleaseCallbackFactory(funcMap))
                    deferred.resolve(proxy(ws, res.remote, res.funcIndex, funcMap))
                }
            }
        }
        ws.on('rpc-connect', rpcConnectCallback)
        return _.extend(deferred.promise, {
            check () {
                console.log(funcMap)
            }
        })
    },
    destroy: function () {
        var ws
        ws = this.ws
        ws.removeListener('rpc-call')
        ws.removeListener('rpc-release')
        ws.removeListener('rpc-return')
        delete this.ws
    }
}
