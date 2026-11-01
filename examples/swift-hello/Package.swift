// swift-tools-version: 6.0
import PackageDescription

// The program of the «Hello from Swift» extension. ./build.sh builds it outside this folder (the app hashes every
// file of an extension: SwiftPM's .build must not land here) and puts the binary at bin/swift-hello.
let package = Package(
    name: "SwiftHello",
    platforms: [.macOS(.v13)],
    dependencies: [.package(name: "SSHKipperSDK", path: "../../packages/swift")],
    targets: [
        .executableTarget(name: "swift-hello", dependencies: [.product(name: "SSHKipperSDK", package: "SSHKipperSDK")], path: "Sources/SwiftHello"),
    ],
    swiftLanguageModes: [.v6]
)
