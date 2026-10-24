# Every Linux server has processes; the service shows where ps and /proc are there.
# GNU ps (procps): busybox's has no -o etimes and --sort the pages need.
if sk_has ps && ps -eo pid= --sort=-pcpu >/dev/null 2>&1 && [ -r /proc/loadavg ]; then echo '{"found": true}'; else echo '{"found": false}'; fi
