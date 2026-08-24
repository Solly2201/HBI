/**
 * Turns the docker stats CSVs from a load run into per-service peak/mean
 * CPU and memory figures.
 *
 *   node benchmarks/summarise-resources.mjs benchmarks/results/resources-100.csv
 */

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node summarise-resources.mjs <resources-N.csv>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
const byService = new Map();

lines.forEach((line) => {
  const [, service, cpu, mem, memPct] = line.split(',');
  if (!service) return;
  const c = parseFloat(cpu);
  const m = parseFloat(mem);
  const mp = parseFloat(memPct);
  if (Number.isNaN(c) || Number.isNaN(m)) return;
  if (!byService.has(service)) byService.set(service, { cpu: [], mem: [], memPct: [] });
  const b = byService.get(service);
  b.cpu.push(c);
  b.mem.push(m);
  if (!Number.isNaN(mp)) b.memPct.push(mp);
});

const rows = [...byService.entries()].map(([service, b]) => {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    service,
    samples: b.cpu.length,
    cpuAvg: Number(avg(b.cpu).toFixed(1)),
    cpuPeak: Number(Math.max(...b.cpu).toFixed(1)),
    memAvgMb: Number(avg(b.mem).toFixed(1)),
    memPeakMb: Number(Math.max(...b.mem).toFixed(1)),
    memPeakPct: b.memPct.length ? Number(Math.max(...b.memPct).toFixed(1)) : null,
  };
}).sort((a, b) => b.cpuPeak - a.cpuPeak);

console.log(`\n${file}`);
console.log('service               samples  cpu_avg%  cpu_peak%  mem_avg_MB  mem_peak_MB  mem_peak%');
rows.forEach((r) => {
  console.log(
    r.service.padEnd(22)
    + String(r.samples).padStart(7)
    + String(r.cpuAvg).padStart(10)
    + String(r.cpuPeak).padStart(11)
    + String(r.memAvgMb).padStart(12)
    + String(r.memPeakMb).padStart(13)
    + String(r.memPeakPct ?? '-').padStart(11)
  );
});

const totalMemPeak = rows.reduce((s, r) => s + r.memPeakMb, 0);
const totalCpuPeak = rows.reduce((s, r) => s + r.cpuPeak, 0);
console.log(`\nsum of per-service peak memory: ${totalMemPeak.toFixed(0)} MB`);
console.log(`sum of per-service peak CPU:    ${totalCpuPeak.toFixed(0)} % (100% = one core)`);
console.log(`busiest service by peak CPU:    ${rows[0]?.service} (${rows[0]?.cpuPeak}%)`);
console.log(JSON.stringify(rows));
