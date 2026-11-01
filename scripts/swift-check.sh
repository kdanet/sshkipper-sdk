#!/bin/sh
# `npm run swift`: the Swift package builds and passes its tests, the swift-hello example builds (outside its folder),
# validates and packs, and answers a handler through the CLI. Its build folders: $SSHKIPPER_SWIFT_BUILD (default — in
# $TMPDIR), so nothing lands in the repository.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=${SSHKIPPER_SWIFT_BUILD:-${TMPDIR:-/tmp}/sshkipper-sdk-swift}
swift test --package-path "$root/packages/swift" --scratch-path "$scratch/package"
SSHKIPPER_SWIFT_BUILD="$scratch/swift-hello" "$root/examples/swift-hello/build.sh" debug
node "$root/packages/cli/sshkipper-ext.ts" validate "$root/examples/swift-hello"
out=$(mktemp -d)
node "$root/packages/cli/sshkipper-ext.ts" pack "$root/examples/swift-hello" -o "$out/swift-hello.sshkext"
rm -rf "$out"
node "$root/packages/cli/sshkipper-ext.ts" run "$root/examples/swift-hello" detect
echo "swift: ok"
