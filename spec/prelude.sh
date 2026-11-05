sk_json_string() {
  printf '%s' "$1" | awk 'BEGIN { ORS = ""; printf "%s", "\"" }
    { if (NR > 1) printf "%s", "\\n"; n = length($0)
      for (i = 1; i <= n; i++) { c = substr($0, i, 1)
        if (c == "\\") printf "%s", "\\\\"; else if (c == "\"") printf "%s", "\\\""
        else if (c == "\t") printf "%s", "\\t"; else if (c == "\r") printf "%s", "\\r"
        else if (c !~ /[\001-\010\013\014\016-\037]/) printf "%s", c } }
    END { printf "%s", "\"" }'
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
  case "$1" in ''|*[!A-Za-z0-9_]*) sk_fail "secret setting key must be letters, digits, _: $1" ;; esac
  sk_k=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  eval "sk_p=\${SK_SECRET_$sk_k:-}"
  [ -n "$sk_p" ] && [ -r "$sk_p" ] || sk_fail "no secret setting $1"
  cat "$sk_p"
}
