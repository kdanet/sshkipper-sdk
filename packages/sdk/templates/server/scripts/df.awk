# `df -P -k` of real file systems as tab-separated "mount device size used pct status" (bytes, %), shared by the
# handlers through `sk_file scripts/df.awk`. POSIX awk: mawk, busybox and BSD awk alike.
#   - a device name may have spaces (macOS "map auto_home"): the fields are counted from the % column;
#   - pseudo file systems (devfs, tmpfs, overlay, squashfs snaps) are always "full" and say nothing: skipped — but
#     not «/» (a container's root is an overlay), and not with -v all=1 (a mount point asked for by name);
#   - numbers go out with %.0f — awk's %d stops at 2 GiB, mawk prints big products as 3.0e+09.
function skip(dev, mount) {
  if (mount == "/") return 0
  return dev ~ /^(devfs|tmpfs|devtmpfs|udev|overlay|shm|none|map )/ || mount ~ /^\/(dev|run|sys|proc|snap)(\/|$)/ ||
         mount ~ /^\/System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)/ || mount ~ /^\/Library\/Developer\/CoreSimulator/
}
NR > 1 {
  p = 0
  for (i = 2; i <= NF; i++) if ($i ~ /^[0-9]+%$/) { p = i; break }
  if (p < 5) next
  mount = $(p + 1); for (i = p + 2; i <= NF; i++) mount = mount " " $i
  dev = $1; for (i = 2; i <= p - 4; i++) dev = dev " " $i
  size = $(p - 3) * 1024; used = $(p - 2) * 1024
  pct = $p; sub(/%/, "", pct); pct += 0
  if (size <= 0 || (!all && skip(dev, mount))) next
  st = pct >= 95 ? "bad" : pct >= warn ? "warn" : "ok"
  printf "%s\t%s\t%.0f\t%.0f\t%d\t%s\n", mount, dev, size, used, pct, st
}
