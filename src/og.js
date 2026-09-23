// src/og.js — 1200x630 分享卡片（X / Discord / Telegram 预览图的数据源）
// 服务器端渲染纯 HTML+SVG，用 tools/screenshot.ps1 -Og 截成 web/og.png。
// 卡片上的数字全部来自 /api/bio/public 同一份数据，不手填。
export function ogHtml(d) {
  const h = d.honesty || {};
  const hist = d.history || [];
  const W = 1072, H = 210, P = 6;
  let spark = '';
  if (hist.length > 1) {
    const maxP = Math.max(...hist.map(r => r.population || 0), 1);
    const pts = hist.map((r, i) =>
      (P + i * (W - 2 * P) / (hist.length - 1)).toFixed(1) + ',' +
      (H - P - (r.population || 0) / maxP * (H - 2 * P)).toFixed(1)).join(' ');
    spark = '<polygon fill="rgba(0,217,146,.15)" points="' + P + ',' + (H - P) + ' ' + pts + ' ' + (W - P) + ',' + (H - P) + '"/>' +
            '<polyline fill="none" stroke="#00d992" stroke-width="4" points="' + pts + '"/>';
  }
  const stat = (label, val, cls) =>
    '<div class="st"><div class="lb">' + label + '</div><div class="vl' + (cls ? ' ' + cls : '') + '">' + val + '</div></div>';
  const sim = ((h.simulatedDemandShareBps || 0) / 100).toFixed(1);
  const css = [
    'html,body{margin:0;background:#070a08}',
    '.card{width:1200px;height:630px;box-sizing:border-box;position:relative;overflow:hidden;color:#dfe7e0;',
    'background:linear-gradient(155deg,#0b100d 0%,#070a08 62%);border:1px solid #1e2b20;padding:52px 64px;',
    'font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.glow{position:absolute;right:-160px;top:-160px;width:560px;height:560px;border-radius:50%;',
    'background:radial-gradient(circle,rgba(0,217,146,.13),rgba(0,217,146,0) 70%)}',
    '.brand{font-size:19px;letter-spacing:.24em;color:#00d992;font-weight:600}',
    'h1{font-size:54px;line-height:62px;margin:16px 0 0;font-weight:500;letter-spacing:-.6px;color:#f2f5f2}',
    '.sub{margin-top:12px;font-size:20px;line-height:29px;color:#8b949e;max-width:860px}',
    '.row{display:flex;gap:52px;margin-top:30px}',
    '.lb{font-size:14px;letter-spacing:.15em;color:#6f7a70;text-transform:uppercase}',
    '.vl{font-size:36px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}',
    '.ok{color:#00d992}.warn{color:#ffd479}',
    '.chart{margin-top:20px}',
    '.foot{position:absolute;left:64px;right:64px;bottom:36px;display:flex;justify-content:space-between;',
    'font-size:16px;color:#6f7a70;font-family:SFMono-Regular,Menlo,Consolas,monospace}',
  ].join('');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<div class="card"><div class="glow"></div>' +
    '<div class="brand">ARC BIOSPHERE &middot; VERIFIABLE AUTONOMOUS ECONOMY</div>' +
    '<h1>No fitness function.<br>Fitness is solvency.</h1>' +
    '<div class="sub">Organisms hold USDC, pay metabolic upkeep or die, and earn revenue from real x402 customers. ' +
    'Population root committed on-chain &mdash; replay it yourself.</div>' +
    '<div class="row">' +
      stat('tick', d.tick) +
      stat('alive', d.alive, 'ok') +
      stat('generations', d.generations) +
      stat('real x402 revenue', '$' + (h.realRevenueUSDC || 0), 'ok') +
      stat('operator subsidy', '$' + (h.subsidyUSDC || 0), 'warn') +
      stat('simulated demand', sim + '%', (h.simulatedDemandShareBps || 0) > 5000 ? 'warn' : 'ok') +
    '</div>' +
    '<div class="chart"><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + spark + '</svg></div>' +
    '<div class="foot"><span>populationRoot ' + String(d.populationRoot || '').slice(0, 34) + '&hellip;</span>' +
    '<span>' + new Date().toISOString().slice(0, 10) + '</span></div>' +
    '</div></body></html>';
}
