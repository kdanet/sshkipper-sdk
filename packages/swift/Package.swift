// swift-tools-version: 6.0
import PackageDescription

// The SSHKipper extension SDK for Swift: the manifest and protocol types, the JSON-RPC loop of a program on this Mac
// (spec/protocol.md §4), helpers for every contribution, UI-Kit builders and ops, and the database protocol
// (spec/database.md). No dependencies, nothing of the app: an extension links it and runs as its own process.
let package = Package(
    name: "SSHKipperSDK",
    platforms: [.macOS(.v13)],
    products: [.library(name: "SSHKipperSDK", targets: ["SSHKipperSDK"])],
    targets: [
        .target(name: "SSHKipperSDK"),
        .testTarget(name: "SSHKipperSDKTests", dependencies: ["SSHKipperSDK"]),
    ],
    swiftLanguageModes: [.v6]
)
