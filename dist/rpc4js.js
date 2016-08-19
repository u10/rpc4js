/*!
 * rpc4js v0.0.1
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

    function mapping(obj, funcIndex, funcMap, opts, path, context) {
        path = path || [];
        if (_.isFunction(obj)) {
            var _ret = (function () {
                var id = uuid.v4();
                if (opts && opts.clear) {
                    opts.clear.push(id);
                }
                funcMap[id] = (function (context) {
                    return function () {
                        var rpc = _.extend({}, opts, { clear: false });
                        var args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
                        var result = obj.apply(context, [rpc].concat(args));
                        if (rpc.clear) {
                            if (opts.clear) {
                                var _iteratorNormalCompletion = true;
                                var _didIteratorError = false;
                                var _iteratorError = undefined;

                                try {
                                    for (var _iterator = opts.clear[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                                        var v = _step.value;

                                        delete funcMap[v];
                                    }
                                } catch (err) {
                                    _didIteratorError = true;
                                    _iteratorError = err;
                                } finally {
                                    try {
                                        if (!_iteratorNormalCompletion && _iterator['return']) {
                                            _iterator['return']();
                                        }
                                    } finally {
                                        if (_didIteratorError) {
                                            throw _iteratorError;
                                        }
                                    }
                                }
                            }
                        } else {
                            if (rpc.release) {
                                delete funcMap[id];
                            }
                        }
                        return result;
                    };
                })(context);
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
                val.push(mapping(obj[i], funcIndex, funcMap, opts, path));
                path.pop();
            }
            return val;
        } else if (_.isObject(obj)) {
            var val = {};
            for (var k in obj) {
                path.push(k);
                val[k] = mapping(obj[k], funcIndex, funcMap, opts, path, obj);
                path.pop();
            }
            return val;
        } else {
            return obj;
        }
    }

    function proxy(ws, obj, funcIndex, funcMap) {
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
                    var args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
                    var deferred = Q.defer();
                    var funcIndex = [];
                    var id = uuid.v4();
                    ws.emit('rpc-call', {
                        id: id,
                        method: method,
                        args: mapping(args, funcIndex, funcMap, { release: true, clear: [] }),
                        funcIndex: funcIndex
                    });
                    var timer = setTimeout(function () {
                        ws.removeListener('rpc-return', callback);
                        deferred.reject();
                    }, 5000);
                    var callback = function callback(res) {
                        if (res.id === id) {
                            clearTimeout(timer);
                            ws.removeListener('rpc-return', callback);
                            if (res.error) {
                                deferred.reject(res.error);
                            } else {
                                deferred.resolve(res.result);
                            }
                        }
                    };
                    ws.on('rpc-return', callback);
                    return deferred.promise;
                };
            })(method);
        }
        return obj;
    }

    function mkRpcCallCallback(ws, funcMap) {
        return function (req) {
            var func = funcMap[req.method];
            if (func) {
                try {
                    var result = func.apply(null, proxy(ws, req.args, req.funcIndex, funcMap));
                    ws.emit('rpc-return', {
                        id: req.id,
                        result: result
                    });
                } catch (e) {
                    ws.emit('rpc-return', {
                        id: req.id,
                        error: e
                    });
                }
            } else {
                ws.emit('rpc-return', {
                    id: req.id,
                    error: 'function not found'
                });
            }
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
                        socket.on('rpc-call', mkRpcCallCallback(socket, funcMap));
                        socket.emit('rpc-connect', {
                            id: req.id,
                            name: req.name,
                            remote: mapping(local, funcIndex, funcMap),
                            funcIndex: funcIndex
                        });
                    } else {
                        socket.emit('rpc-connect', {
                            id: req.id,
                            name: req.name,
                            error: 'object not found'
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
        connect: function connect(name, local) {
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
                deferred.reject('timeout');
            }, 5000);
            var id = uuid.v4();
            ws.emit('rpc-connect', {
                id: id,
                name: name,
                client: mapping(local, funcIndex, funcMap),
                funcIndex: funcIndex
            });
            var rpcConnectCallback = function rpcConnectCallback(res) {
                if (res.id === id) {
                    if (res.error) {
                        release();
                        deferred.reject(res.error);
                    } else {
                        clearTimeout(timer);
                        ws.removeListener('rpc-connect', rpcConnectCallback);
                        ws.on('rpc-call', mkRpcCallCallback(ws, funcMap));
                        deferred.resolve(proxy(ws, res.remote, res.funcIndex, funcMap));
                    }
                }
            };
            ws.on('rpc-connect', rpcConnectCallback);
            return deferred.promise;
        },
        destroy: function destroy() {
            var ws;
            ws = this.ws;
            ws.removeListener('rpc-call');
            ws.removeListener('rpc-return');
            delete this.ws;
        }
    };

    return index;

}));