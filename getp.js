const axios = require('axios');
const fs = require('fs');

const proxyURLs = [
  'https://api.proxyscrape.com/?request=displayproxies&proxytype=http',
  'https://proxyspace.pro/http.txt'
  // Tambahkan URL tambahan jika perlu
];

const proxyFile = 'proxy.txt';

async function downloadProxiesFromURL(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error(`❌ Error downloading from ${url}:`, error.message);
    return '';
  }
}

function filterValidProxies(data) {
  const lines = data.split(/\r?\n/);
  const valid = lines.filter(line =>
    /^\\d{1,3}(\\.\\d{1,3}){3}:\\d{2,5}$/.test(line.trim())
  );
  return valid;
}

async function downloadProxies() {
  let proxySet = new Set();

  for (const url of proxyURLs) {
    const rawData = await downloadProxiesFromURL(url);
    const validProxies = filterValidProxies(rawData);
    validProxies.forEach(proxy => proxySet.add(proxy));
  }

  const finalList = Array.from(proxySet).join('\n');
  if (finalList) {
    fs.writeFileSync(proxyFile, finalList, 'utf-8');
    console.log(`✅ ${proxySet.size} proxies saved to ${proxyFile}`);
  } else {
    console.error('⚠️ No valid proxies found.');
  }
}

downloadProxies();
