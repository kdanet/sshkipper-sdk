# One process from /proc: state, threads, memory, its files and environment size, the command line.
pid=$SK_ITEM_ID
case "$pid" in ''|*[!0-9]*) sk_fail "Нет PID" ;; esac
[ -d "/proc/$pid" ] || sk_fail "Процесса $pid уже нет"
st=$(awk '/^State:/ { $1 = ""; sub(/^ /, ""); print }' "/proc/$pid/status")
name=$(awk '/^Name:/ { print $2 }' "/proc/$pid/status")
threads=$(awk '/^Threads:/ { print $2 }' "/proc/$pid/status")
# %.0f: mawk prints big products as 3.072e+09, and awk's %d stops at 2 GiB.
rss=$(awk '/^VmRSS:/ { printf "%.0f", $2 * 1024 }' "/proc/$pid/status"); rss=${rss:-0}
user=$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')
up=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' '); up=${up:-0}
fds=$(ls "/proc/$pid/fd" 2>/dev/null | wc -l | tr -d ' ')
cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo "—")
printf '{"pid":%d,"name":%s,"state":%s,"threads":%d,"rss":%s,"user":%s,"uptime":%d,"fds":%s,"command":%s,"cwd":%s}' \
  "$pid" "$(sk_json_string "$name")" "$(sk_json_string "$st")" "${threads:-0}" "$rss" "$(sk_json_string "$user")" "$up" \
  "$(sk_json_string "$fds")" "$(sk_json_string "$cmd")" "$(sk_json_string "$cwd")"
