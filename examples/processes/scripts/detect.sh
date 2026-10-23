# Every Linux server has processes; the service shows where ps and /proc are there.
if sk_has ps && [ -r /proc/loadavg ]; then echo '{"found": true}'; else echo '{"found": false}'; fi
