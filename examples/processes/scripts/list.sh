# The busiest processes by CPU as JSON (POSIX awk; the strings escaped by hand: jq is not assumed).
limit=${SK_SETTING_LIMIT:-40}
busy=${SK_SETTING_BUSY:-80}
case "$limit" in *[!0-9]*|'') limit=40 ;; esac
sk_has ps || sk_fail "На сервере нет ps"
# busybox ps (Alpine) has no -o etimes / --sort: say so instead of an empty list.
ps -eo pid= --sort=-pcpu >/dev/null 2>&1 || sk_fail "Нужен ps из procps (в Alpine: apk add procps)"
ps -eo pid=,ppid=,user=,pcpu=,pmem=,rss=,etimes=,comm=,args= --sort=-pcpu 2>/dev/null | head -n "$limit" | awk -v busy="$busy" '
  # JSON strings char by char: gsub replacements treat backslashes differently in busybox, mawk and BSD awk.
  function js(s,   o, i, c) { o = ""; for (i = 1; i <= length(s); i++) { c = substr(s, i, 1)
    if (c == "\\") o = o "\\\\"; else if (c == "\"") o = o "\\\""; else if (c == "\t") o = o "\\t"; else if (c >= " ") o = o c }
    return "\"" o "\"" }
  BEGIN { printf "{\"processes\":[" }
  {
    pid = $1; ppid = $2; user = $3; cpu = $4 + 0; mem = $5 + 0; rss = $6 * 1024; up = $7 + 0; name = $8
    $1 = $2 = $3 = $4 = $5 = $6 = $7 = $8 = ""; sub(/^ +/, ""); cmd = $0
    st = cpu >= busy ? "warn" : "ok"
    if (st == "warn") nbusy++
    # The first five also as summary items of the automation block (protocol.md §8).
    if (NR <= 5) top = top (NR > 1 ? "," : "") sprintf("{\"label\":%s,\"value\":\"%s%%\",\"status\":\"%s\",\"detail\":%s}", js(name " (" pid ")"), cpu, st, js(user))
    if (NR == 1) first = name " " cpu "%"
    if (NR > 1) printf ","
    printf "{\"id\":%s,\"pid\":%d,\"ppid\":%d,\"user\":%s,\"cpu\":%s,\"mem\":%s,\"rss\":%.0f,\"uptime\":%d,\"name\":%s,\"command\":%s,\"status\":\"%s\"}",
      js(pid), pid, ppid, js(user), cpu, mem, rss, up, js(name), js(cmd), st
  }
  END {
    printf "],\"status\":\"%s\",\"value\":%d,\"summary\":%s,\"items\":[%s]}", (nbusy > 0 ? "warn" : "ok"), NR,
      js(NR == 0 ? "Процессов нет" : "Больше всего CPU: " first (nbusy > 0 ? " · занятых: " nbusy : "")), top
  }'
