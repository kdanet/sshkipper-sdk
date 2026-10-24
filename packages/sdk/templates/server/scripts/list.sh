# File systems as JSON: {"disks": [{"id", "mount", "device", "size", "used", "pct", "status"}]}, the fullest first.
# The parsing is shared with the other handlers: scripts/df.awk, brought along with `sk_file`.
warn=${SK_SETTING_WARN_PCT:-85}
case "$warn" in ''|*[!0-9]*) warn=85 ;; esac
sk_file scripts/df.awk > "$SK_TMP/df.awk"
df -P -k 2>/dev/null | awk -v warn="$warn" -f "$SK_TMP/df.awk" | sort -t "$(printf '\t')" -k5,5nr > "$SK_TMP/disks"
printf '{"disks": ['
first=1
while IFS="$(printf '\t')" read -r mount dev size used pct st; do
  [ "$first" = 1 ] || printf ', '; first=0
  printf '{"id": %s, "mount": %s, "device": %s, "size": %s, "used": %s, "pct": %s, "status": "%s"}' \
    "$(sk_json_string "$mount")" "$(sk_json_string "$mount")" "$(sk_json_string "$dev")" "$size" "$used" "$pct" "$st"
done < "$SK_TMP/disks"
printf ']}'
