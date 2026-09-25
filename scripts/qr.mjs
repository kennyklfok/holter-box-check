import QRCode from 'qrcode';
import { writeFile } from 'node:fs/promises';

const input = process.argv[2];
let url;
try { url = new URL(input); } catch { /* Shown below. */ }
if (!url || url.protocol !== 'https:' || !url.hostname.endsWith('.pages.dev') || url.username || url.password || url.search || url.hash) {
  console.error('Usage: npm run qr -- https://YOUR-PROJECT.pages.dev/');
  process.exit(1);
}

const finalUrl = url.toString();
const svg = await QRCode.toString(finalUrl, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, width: 520, color: { dark: '#214b39', light: '#ffffff' } });
const safeUrl = finalUrl.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const poster = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Holter Box Check QR</title>
<style>body{font-family:Arial,sans-serif;color:#213630;margin:0}main{max-width:650px;margin:45px auto;text-align:center;border:2px solid #dce9de;border-radius:18px;padding:40px}h1{font-size:32px;margin:0 0 8px}p{font-size:18px;margin:8px 0 25px}.qr{width:100%;max-width:480px;margin:auto}.qr svg{width:100%;height:auto}strong{display:block;font-size:18px;margin:22px 0 8px}.url{font-size:14px;overflow-wrap:anywhere;color:#4e765d}.foot{border-top:1px solid #dce9de;margin-top:24px;padding-top:19px;color:#5f7265;font-size:14px}@media print{main{margin:20mm auto;break-inside:avoid}}</style></head>
<body><main><h1>Holter drop-off box</h1><p>Main entrance · Staff check-in</p><div class="qr">${svg}</div><strong>Scan to record a box check</strong><div class="url">${safeUrl}</div><div class="foot">Staff use only. Enter the shared passcode on the website.<br>Do not enter patient information.</div></main></body></html>`;
await writeFile('qr-poster.html', poster, 'utf8');
console.log('Created qr-poster.html. Open it in a browser and print at 100% scale.');
