import CryptoKit
import Foundation

/// A durable byte cache for the embedded pack renderer.
///
/// `WKWebView`'s HTTP cache is intentionally treated as an optimization rather
/// than the source of truth: WebKit may evict it or obey short server cache
/// headers. Keeping pack manifests, meshes, wrapper sheets, and card textures
/// under TCGer's cache directory lets a previously viewed asset load again
/// without a connection. The app's existing Clear Cache action removes this
/// directory along with the rest of `TCGerCache`.
final class PackOpeningAssetCache: @unchecked Sendable {
    static let shared = PackOpeningAssetCache()

    private let fileManager: FileManager
    private let directory: URL
    private let queue = DispatchQueue(label: "com.tcger.pack-opening-asset-cache")

    init(
        directory: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        if let directory {
            self.directory = directory
        } else {
            let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
            self.directory = documents
                .appendingPathComponent("TCGerCache", isDirectory: true)
                .appendingPathComponent("PackOpeningAssets", isDirectory: true)
        }
    }

    func data(for remoteURL: URL) -> Data? {
        queue.sync {
            try? ensureDirectory()
            return try? Data(contentsOf: fileURL(for: remoteURL), options: .mappedIfSafe)
        }
    }

    func store(_ data: Data, for remoteURL: URL) {
        queue.sync {
            do {
                try ensureDirectory()
                try data.write(to: fileURL(for: remoteURL), options: [.atomic])
            } catch {
                // Asset caching must never make an otherwise successful pack
                // request fail. A later request can retry the write.
            }
        }
    }

    private func ensureDirectory() throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func fileURL(for remoteURL: URL) -> URL {
        let digest = SHA256.hash(data: Data(remoteURL.absoluteString.utf8))
        let filename = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(filename).asset")
    }
}
