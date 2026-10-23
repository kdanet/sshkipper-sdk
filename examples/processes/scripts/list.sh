# The busiest processes by CPU as JSON (POSIX awk; the strings escaped by hand: jq is not assumed).
limit=${SK_SETTING_LIMIT:-40}
busy=${SK_SETTING_BUSY:-80}
case "$limit" in *[!0-9]*|'') limit=40 ;; esac
sk_has ps || sk_fail "На сервере нет ps"
ps -eo pid=,ppid=,user=,pcpu=,pmem=,rss=,etimes=,comm=,args= --sort=-pcpu 2>/dev/null | head -n "$limit" | awk -v busy="$busy" '
  function js(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, "\\t", s); return "\"" s "\"" }
  BEGIN { printf "{\"processes\":[" }
  {
    pid = $1; ppid = $2; user = $3; cpu = $4 + 0; mem = $5 + 0; rss = $6 * 1024; up = $7 + 0; name = $8
    $1 = $2 = $3 = $4 = $5 = $6 = $7 = $8 = ""; sub(/^ +/, ""); cmd = $0
    st = cpu >= busy ? "warn" : "ok"
    if (NR > 1) printf ","
    printf "{\"id\":%s,\"pid\":%d,\"ppid\":%d,\"user\":%s,\"cpu\":%s,\"mem\":%s,\"rss\":%d,\"uptime\":%d,\"name\":%s,\"command\":%s,\"status\":\"%s\"}",
      js(pid), pid, ppid, js(user), cpu, mem, rss, up, js(name), js(cmd), st
  }
  END { printf "]}" }'
