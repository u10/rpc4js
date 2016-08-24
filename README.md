# rpc4js
rpc4js 是一个RPC(remote procedure call)的 Javascript 实现.

* 简单易用,低侵入
* 支持无限级回调嵌套
* 支持自动资源释放
* 支持手动资源释放

## 安装

通过 NPM 安装, 执行以下命令:

```bash
npm install u10/rpc4js
```

## 快速指南

### 客户端(浏览器)

> 依赖库
> * lodash.js
> * node-uuid.js
> * socket.io-client.js
> * q.js

```javascript
    // 定义websocket
    var ws = io('ws://' + window.location.host, {
        autoConnect: false
    });

    // 将rpc4js绑定到websocket连接
    rpc4js.bind(ws);

    // 连接websocket
    ws.connect();

    // 连接远程对象
    rpc4js.connect('RemoteObjectName', {
        PROP: 'Test',
        FUNC: function (msg) {
            console.log(msg);
        }
    }).then(function (remote) {
        // 远程对象属性
        console.log('remote.prop = ' + remote.prop);

        // 远程对象方法
        remote.func('call func');

        // 远程对象方法(回调)
        remote.func_with_callback(function (msg) {
            console.log(msg);
        });
    });
```

### 服务器端(NodeJS)

```javascript
    var http = require('http');
    var socketIo = require('socket.io');
    var rpc4js = require('rpc4js');

    // 构造websocket服务
    var server = http.createServer();
    var ws = socketIo.listen(server);

    // 定义远程对象
    rpc4js
        .define('RemoteObjectName', function (client) {
            return {
                prop: 'prop',
                func: function (msg) {
                    console.log(this.PROP)
                    client.FUNC('echo ' + msg)
                },
                func_with_callback: function (callback) {
                    callback('this is a msg from server.')
                }
            }
        })
        .listen(ws)
```

## API

### rpc4js.define(name, constructor)
> * 适用: 服务器端
> * 功能: 定义一个远程对象
> * 参数:
>   * name {String} 待定义对象的名字
>   * constructor(client) {Function} 对象的构造器
>     * 参数: client {Object} 建立连接后的客户端对象代理
>     * 返回: {Object} 待返回的远程对象
> * 返回: rpc4js 用于支持链式调用


### rpc4js.listen(ws)
> * 适用: 服务器端
> * 功能: 启动远程对象服务
> * 参数:
>   * ws WebSocket连接实例

### rpc4js.bind(ws)
> * 适用: 浏览器端
> * 功能: 绑定到WebocketS连接
> * 参数:
>   * ws WebSocket连接实例
> * 返回: rpc4js 用于支持链式调用

### rpc4js.connect(name, local)
> * 适用: 浏览器端
> * 功能: 将一个本地对象连接到远程对象
> * 参数:
>   * name {String} 远程对象的名字
>   * local {Object} 本地对象
> * 返回: promise对象
>   * promise.then(remote)
>     * remote 远程对象
>       * remote是的远程对象的代理,使用方式和本地对象一样
>       * remote的函数均返回promise对象,通过then(result)获取返回值
>   * promise.fail(error)
>     * error 连接失败的错误信息

## 关于资源释放

资源释放分为自动和手动两种,一般使用自动释放即可,默认自动释放,无需特别配置.

自动释放模式有以下一些限制:
* 对象方法的函数参数(即回调函数)只允许调用一次,因为调用一次后就自动释放了.
* 对象方法的函数参数(即回调函数)只有被调用过才会释放,应避免传递不会回调到的函数.

手动资源释放虽然灵活,但是控制上较为繁琐.

```javascript
// 手动释放资源
var rpc = remote.func(function() {
  // callback1
  rpc.end()
}, function() {
  // callback2
  rpc.end()
}).config({
    autoRelease: false
})
```