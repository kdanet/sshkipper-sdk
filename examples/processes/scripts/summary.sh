# One line for the section bar: how many processes, and the busiest one.
n=$(ps -e --no-headers 2>/dev/null | wc -l | tr -d ' ')
top=$(ps -eo pcpu=,comm= --sort=-pcpu 2>/dev/null | head -n 1)
cpu=${top%% *}; set -- $top; name=$2
st=ok; awk -v c="$1" 'BEGIN { exit !(c >= 90) }' && st=warn
sk_json_kv text "$n процессов · больше всего CPU: $name ($1%)" status "$st"
