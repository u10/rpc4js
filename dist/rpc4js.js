/*!
 * rpc4js v0.1.0
 * (c) 2016 Vaniship
 * Released under the MIT License.
 */
(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('lodash'), require('q'), require('node-uuid')) :
    typeof define === 'function' && define.amd ? define(['lodash', 'q', 'node-uuid'], factory) :
    global.rpc4js = factory(global._,global.Q,global.uuid);
}(this, function (_,Q,uuid) { 'use strict';

    _ = 'default' in _ ? _['default'] : _;
    Q = 'default' in Q ? Q['default'] : Q;
    uuid = 'default' in uuid ? uuid['default'] : uuid;

    var slice = [].slice;
    var localConstructors = {};

    function release(id, funcMap) {
        if (funcMap[id]) {
            for (var index in funcMap[id]) {
                delete funcMap[funcMap[id][index]];
            }
            funcMap[id] = false;
            setTimeout(function () {
                delete funcMap[id];
            }, 100);
        }
    }

    function clear(funcIndex, funcMap) {
        for (var index in funcIndex) {
            var key = funcIndex[index];
            delete funcMap[key[key.length - 1]];
        }
    }

    function mapping(obj, funcIndex, funcMap, options, path, context) {
        path = path || [];
        if (_.isFunction(obj)) {
            var _ret = (function () {
                var id = uuid.v4();
                if (!options.autoRelease && options.id) {
                    if (options.disposed || funcMap[options.id] === false) {
                        return {
                            v: 0
                        };
                    }
                    (funcMap[options.id] = funcMap[options.id] || []).push(id);
                }
                funcMap[id] = function () {
                    var deferred = Q.defer();
                    var args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
                    try {
                        deferred.resolve(obj.apply(context, args));
                        if (options.autoRelease) {
                            delete funcMap[id];
                        }
                    } catch (error) {
                        deferred.reject({ message: error.message });
                        if (options.autoRelease) {
                            funcIndex = clear(funcIndex, funcMap);
                            delete funcMap[id];
                        }
                    }
                    return deferred.promise;
                };
                funcIndex.push(path.concat([id]));
                return {
                    v: 0
                };
            })();

            if (typeof _ret === 'object') return _ret.v;
        } else if (_.isArray(obj)) {
            var val = [];
            for (var i = 0, len = obj.length; i < len; i++) {
                path.push(i);
                val.push(mapping(obj[i], funcIndex, funcMap, options, path));
                path.pop();
            }
            return val;
        } else if (_.isObject(obj)) {
            var val = {};
            for (var k in obj) {
                path.push(k);
                val[k] = mapping(obj[k], funcIndex, funcMap, options, path, obj);
                path.pop();
            }
            return val;
        } else {
            return obj;
        }
    }

    function proxy(ws, obj, funcIndex, funcMap, options) {
        var method, o, v;
        for (var i = 0, m = funcIndex.length; i < m; i++) {
            v = funcIndex[i];
            o = obj;
            for (var j = 0, n = v.length - 2; j < n; j++) {
                o = o[v[j]];
            }
            method = v[v.length - 1];
            o[v[v.length - 2]] = (function (method) {
                return function () {
                    var deferred = Q.defer();
                    var args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
                    var id = uuid.v4();
                    var _config = _.extend({
                        timeout: 5000,
                        autoRelease: true,
                        id: id
                    }, options);
                    var funcIndex = [];
                    setTimeout(function () {
                        var timer = setTimeout(function () {
                            ws.removeListener('rpc-return', callback);
                            deferred.reject({ message: 'timeout' });
                        }, _config.timeout);
                        var callback = function callback(res) {
                            if (res.id === id) {
                                clearTimeout(timer);
                                ws.removeListener('rpc-return', callback);
                                if (res.error) {
                                    deferred.reject(res.error);
                                    if (_config.autoRelease) {
                                        funcIndex = clear(funcIndex, funcMap);
                                        delete funcMap[method];
                                    }
                                } else {
                                    deferred.resolve(res.result);
                                    if (_config.autoRelease) {
                                        delete funcMap[method];
                                    }
                                }
                            }
                        };
                        ws.emit('rpc-call', {
                            id: id,
                            method: method,
                            args: mapping(args, funcIndex, funcMap, _config),
                            funcIndex: funcIndex,
                            options: _config
                        });
                        ws.on('rpc-return', callback);
                    }, 0);
                    var promise = _.extend(deferred.promise, {
                        config: function config(conf) {
                            _.extend(_config, conf);
                            return promise;
                        },
                        end: function end() {
                            if (!_config.autoRelease) {
                                _config.disposed = true;
                                release(id, funcMap);
                                ws.emit('rpc-release', { id: id });
                            }
                        }
                    });
                    return promise;
                };
            })(method);
        }
        return obj;
    }

    function rpcCallCallbackFactory(ws, funcMap) {
        return function (req) {
            var func = funcMap[req.method];
            if (func) {
                func.apply(null, proxy(ws, req.args, req.funcIndex, funcMap, req.options)).then(function (result) {
                    ws.emit('rpc-return', {
                        id: req.id,
                        result: result
                    });
                }).fail(function (error) {
                    ws.emit('rpc-return', {
                        id: req.id,
                        error: error
                    });
                });
            } else {
                ws.emit('rpc-return', {
                    id: req.id,
                    error: { message: 'function not found' }
                });
            }
        };
    }

    function rpcReleaseCallbackFactory(funcMap) {
        return function (req) {
            release(req.id, funcMap);
        };
    }

    var index = {
        define: function define(name, constructor) {
            localConstructors[name] = constructor;
            return this;
        },
        listen: function listen(ws) {
            this.ws = ws;
            ws.on('connect', function (socket) {
                var funcMap = {};
                var funcIndex = [];
                socket.on('rpc-connect', function (req) {
                    var constructor = localConstructors[req.name];
                    if (constructor) {
                        var local = constructor(proxy(socket, req.client, req.funcIndex, funcMap));
                        socket.on('rpc-call', rpcCallCallbackFactory(socket, funcMap));
                        socket.on('rpc-release', rpcReleaseCallbackFactory(funcMap));
                        socket.emit('rpc-connect', {
                            id: req.id,
                            name: req.name,
                            remote: mapping(local, funcIndex, funcMap, req.options),
                            funcIndex: funcIndex
                        });
                    } else {
                        socket.emit('rpc-connect', {
                            id: req.id,
                            name: req.name,
                            error: { message: 'object not found' }
                        });
                    }
                }).on('disconnect', function () {
                    funcMap = undefined;
                    funcIndex = undefined;
                });
            });
        },
        bind: function bind(ws) {
            this.ws = ws;
            return this;
        },
        connect: function connect(name, local, options) {
            options = _.extend({
                timeout: 5000,
                autoRelease: false
            }, options);
            var deferred = Q.defer();
            var ws = this.ws;
            var funcIndex = [];
            var funcMap = {};

            function release() {
                clearTimeout(timer);
                ws.removeListener('rpc-connect', rpcConnectCallback);
                funcMap = undefined;
                funcIndex = undefined;
            }

            var timer = setTimeout(function () {
                release();
                deferred.reject({ message: 'timeout' });
            }, options.timeout);
            var id = uuid.v4();
            ws.emit('rpc-connect', {
                id: id,
                name: name,
                client: mapping(local, funcIndex, funcMap, options),
                funcIndex: funcIndex,
                options: options
            });
            var rpcConnectCallback = function rpcConnectCallback(res) {
                if (res.id === id) {
                    if (res.error) {
                        release();
                        deferred.reject(res.error);
                    } else {
                        clearTimeout(timer);
                        ws.removeListener('rpc-connect', rpcConnectCallback);
                        ws.on('rpc-call', rpcCallCallbackFactory(ws, funcMap));
                        ws.on('rpc-release', rpcReleaseCallbackFactory(funcMap));
                        deferred.resolve(proxy(ws, res.remote, res.funcIndex, funcMap));
                    }
                }
            };
            ws.on('rpc-connect', rpcConnectCallback);
            return _.extend(deferred.promise, {
                check: function check() {
                    console.log(funcMap);
                }
            });
        },
        destroy: function destroy() {
            var ws;
            ws = this.ws;
            ws.removeListener('rpc-call');
            ws.removeListener('rpc-release');
            ws.removeListener('rpc-return');
            delete this.ws;
        }
    };

    return index;

}));