#!/usr/bin/env bash
# Samples `docker stats` into a CSV while a load test runs.
#   bash sample-resources.sh <output.csv> <seconds>
OUT="${1:-/tmp/resources.csv}"
SECS="${2:-120}"

echo "ts,service,cpu_pct,mem_used_mb,mem_pct,net_io,block_io,pids" > "$OUT"

END=$(( $(date +%s) + SECS ))
while [ "$(date +%s)" -lt "$END" ]; do
  TS=$(date +%s)
  docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}" 2>/dev/null \
  | while IFS='|' read -r name cpu mem memp net blk pids; do
      # "123.4MiB / 3.7GiB" -> megabytes
      used=$(echo "$mem" | awk -F' / ' '{print $1}')
      mb=$(echo "$used" | awk '
        /GiB/ {gsub(/GiB/,""); printf "%.1f", $1*1024; next}
        /MiB/ {gsub(/MiB/,""); printf "%.1f", $1; next}
        /KiB/ {gsub(/KiB/,""); printf "%.3f", $1/1024; next}
        {print "0"}')
      svc=$(echo "$name" | sed 's/^hbi-distributed-//; s/-1$//')
      echo "$TS,$svc,${cpu%\%},$mb,${memp%\%},\"$net\",\"$blk\",$pids" >> "$OUT"
    done
  sleep 2
done
echo "sampled to $OUT"
