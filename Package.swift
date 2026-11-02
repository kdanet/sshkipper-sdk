// swift-tools-version: 6.0
import PackageDescription

// The SDK's Swift package for a dependency by Git URL — `.package(url: "https://github.com/kdanet/sshkipper-sdk.git",
// branch: "main")`: SwiftPM reads the manifest at the root of a repository. The sources are those of packages/swift,
// whose own manifest builds and tests them (`npm run swift`).
let package = Package(
    name: "SSHKipperSDK",
    platforms: [.macOS(.v13)],
    products: [.library(name: "SSHKipperSDK", targets: ["SSHKipperSDK"])],
    targets: [.target(name: "SSHKipperSDK", path: "packages/swift/Sources/SSHKipperSDK")],
    swiftLanguageModes: [.v6]
)
