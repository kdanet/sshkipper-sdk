# One script for three handlers: the handler's name says the signal. The PID comes from the row (item) or the
# agent's input — a number only.
case "$SK_HANDLER" in
  signal_term) sig=TERM ;; signal_hup) sig=HUP ;; signal_kill) sig=KILL ;; *) sk_fail "unknown handler $SK_HANDLER" ;;
esac
pid=${SK_INPUT_PID:-$SK_ITEM_ID}
case "$pid" in ''|*[!0-9]*) sk_fail "Нет PID" ;; esac
[ "$pid" -gt 1 ] || sk_fail "PID 1 не трогаем"
kill -s "$sig" "$pid" 2>&1 >/dev/null || sk_fail "Не удалось послать $sig процессу $pid (нужны права?)"
sk_json_kv message "Процессу $pid послан $sig" status ok
