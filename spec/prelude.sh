sk_json_string() {
  printf '%s' "$1" | awk 'BEGIN { ORS = ""; printf "\"" }
    { if (NR > 1) printf "\\n"; s = $0; gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, "\\t", s); gsub(/\r/, "\\r", s)
      gsub(/[\001-\010\013\014\016-\037]/, "", s); printf "%s", s }
    END { printf "\"" }'
}
sk_json_kv() {
  printf '{'; sk_first=1
  while [ $# -ge 2 ]; do
    [ "$sk_first" = 1 ] || printf ','; sk_first=0
    sk_json_string "$1"; printf ':'; sk_json_string "$2"; shift 2
  done
  printf '}'
}
sk_fail() { printf '%s\n' "$*" >&2; exit 1; }
sk_has() { command -v "$1" >/dev/null 2>&1; }
sk_secret() {
  sk_k=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  eval "sk_p=\${SK_SECRET_$sk_k:-}"
  [ -n "$sk_p" ] && [ -r "$sk_p" ] || sk_fail "no secret setting $1"
  cat "$sk_p"
}
