# The line next to the service in the tree: {"text", "status"} — the fullest file system.
warn=${SK_SETTING_WARN_PCT:-85}
case "$warn" in ''|*[!0-9]*) warn=85 ;; esac
sk_file scripts/df.awk > "$SK_TMP/df.awk"
top=$(df -P -k 2>/dev/null | awk -v warn="$warn" -f "$SK_TMP/df.awk" | sort -t "$(printf '\t')" -k5,5nr | head -n 1)
[ -n "$top" ] || { sk_json_kv text "—" status off; exit 0; }
IFS="$(printf '\t')" read -r mount dev size used pct st <<EOT
$top
EOT
sk_json_kv text "$mount — $pct%" status "$st"
