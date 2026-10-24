# Load, cores, memory and the number of processes, from /proc (no root needed).
read -r l1 l5 l15 _ _ < /proc/loadavg
# Processes, not threads (the 4th field of loadavg counts every scheduling entity).
procs=$(ls -d /proc/[0-9]* 2>/dev/null | wc -l | tr -d ' ')
cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c ^processor /proc/cpuinfo)
awk -v l1="$l1" -v l5="$l5" -v l15="$l15" -v procs="$procs" -v cpus="$cpus" '
  /^MemTotal:/ { t = $2 * 1024 } /^MemAvailable:/ { a = $2 * 1024 }
  END {
    used = t - a; pct = t > 0 ? used * 100 / t : 0
    st = (l1 / (cpus > 0 ? cpus : 1) > 1.5) ? "warn" : "ok"
    printf "{\"load1\":%s,\"load5\":%s,\"load15\":%s,\"load_status\":\"%s\",\"cpus\":%d,\"procs\":%d,\"mem_total\":%.0f,\"mem_used\":%.0f,\"mem_pct\":%.0f}",
      l1, l5, l15, st, cpus, procs, t, used, pct
  }' /proc/meminfo
