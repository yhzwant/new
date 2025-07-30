const fs = require('fs');
const UserAgent = require('user-agents');

const OUTPUT_FILE = 'ua.txt';
const TOTAL = 1000; // Jumlah user-agent yang ingin digenerate

const userAgents = new Set();

while (userAgents.size < TOTAL) {
  const ua = new UserAgent().toString();
  userAgents.add(ua);
}

fs.writeFileSync(OUTPUT_FILE, [...userAgents].join('\n'), 'utf-8');
console.log(`✅ ${userAgents.size} User-Agent berhasil disimpan ke '${OUTPUT_FILE}'`);
