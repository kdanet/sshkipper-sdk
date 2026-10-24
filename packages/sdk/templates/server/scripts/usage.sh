# The automation block: one mount point's use, in the automations' summary words (status, summary, value, unit —
# protocol.md §8). The card's parameter arrives as $SK_INPUT_MOUNT, already checked against its pattern.
mount=${SK_INPUT_MOUNT:-/}
warn=${SK_SETTING_WARN_PCT:-85}
case "$warn" in ''|*[!0-9]*) warn=85 ;; esac
sk_file scripts/df.awk > "$SK_TMP/df.awk"
line=$(df -P -k -- "$mount" 2>/dev/null | awk -v warn="$warn" -v all=1 -f "$SK_TMP/df.awk" | head -n 1)
[ -n "$line" ] || sk_fail "no file system at $mount"
IFS="$(printf '\t')" read -r m dev size used pct st <<EOT
$line
EOT
[ "$st" = bad ] && st=error
printf '{"status": "%s", "summary": %s, "value": %s, "unit": "%%"}' "$st" "$(sk_json_string "$m — $pct%")" "$pct"
