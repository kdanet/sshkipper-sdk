#!/bin/sh
# Builds the program into bin/swift-hello. SwiftPM's build folder goes outside the extension (the app hashes every
# file of an extension folder, and .build holds thousands): $SSHKIPPER_SWIFT_BUILD, else a folder in $TMPDIR.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
scratch=${SSHKIPPER_SWIFT_BUILD:-${TMPDIR:-/tmp}/sshkipper-swift-hello-build}
config=${1:-release}
swift build -c "$config" --package-path "$here" --scratch-path "$scratch"
mkdir -p "$here/bin"
cp "$scratch/$config/swift-hello" "$here/bin/swift-hello"
echo "$here/bin/swift-hello"
