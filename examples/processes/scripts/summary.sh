# One line for the section bar: how many processes, and the busiest one.
n=$(ls -d /proc/[0-9]* 2>/dev/null | wc -l | tr -d ' ')
top=$(ps -eo pcpu=,comm= --sort=-pcpu 2>/dev/null | head -n 1)
set -f; set -- $top; set +f
[ $# -ge 2 ] || { sk_json_kv text "Процессов: $n" status ok; exit 0; }
st=ok; awk -v c="$1" 'BEGIN { exit !(c >= 90) }' && st=warn
sk_json_kv text "Процессов: $n · больше всего CPU: $2 ($1%)" status "$st"
