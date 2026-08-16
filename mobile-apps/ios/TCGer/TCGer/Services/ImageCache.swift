import Foundation
import UIKit
import CryptoKit

final class ImageCache {
    static let shared = ImageCache()

    private let memoryCache = NSCache<NSString, UIImage>()
    private let fileManager = FileManager.default
    private let cacheDirectory: URL
    private let queue = DispatchQueue(label: "com.tcg.imagecache.queue")

    private init() {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        cacheDirectory = documentsPath.appendingPathComponent("TCGerCache/Images", isDirectory: true)

        if !fileManager.fileExists(atPath: cacheDirectory.path) {
            try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        }
        memoryCache.countLimit = 256
    }

    // MARK: - Public API

    func image(for url: URL) -> UIImage? {
        let key = cacheKey(for: url)
        if let cached = memoryCache.object(forKey: key) {
            return cached
        }

        let fileURL = diskURL(for: url)
        guard fileManager.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL),
              let image = UIImage(data: data) else {
            return nil
        }

        memoryCache.setObject(image, forKey: key)
        return image
    }

    func store(_ image: UIImage, data: Data? = nil, for url: URL) {
        let key = cacheKey(for: url)
        memoryCache.setObject(image, forKey: key)

        queue.async {
            if !self.fileManager.fileExists(atPath: self.cacheDirectory.path) {
                try? self.fileManager.createDirectory(at: self.cacheDirectory, withIntermediateDirectories: true)
            }

            let fileURL = self.diskURL(for: url)

            if let payload = data {
                try? payload.write(to: fileURL, options: [.atomic])
            } else if let representation = image.pngData() {
                try? representation.write(to: fileURL, options: [.atomic])
            }
        }
    }

    /// Offline set downloads must not report completion while their native
    /// thumbnails are still queued for disk writes. The normal scrolling path
    /// remains asynchronous through `store(_:data:for:)`.
    func storeForOffline(_ image: UIImage, data: Data, for url: URL) {
        memoryCache.setObject(image, forKey: cacheKey(for: url))
        queue.sync {
            if !fileManager.fileExists(atPath: cacheDirectory.path) {
                try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            }
            try? data.write(to: diskURL(for: url), options: [.atomic])
        }
    }

    func hasImage(for url: URL) -> Bool {
        if memoryCache.object(forKey: cacheKey(for: url)) != nil {
            return true
        }
        return fileManager.fileExists(atPath: diskURL(for: url).path)
    }

    func prefetch(urlStrings: [String]) {
        let urls = urlStrings.compactMap { URL(string: $0) }
        prefetch(urls: urls)
    }

    func prefetch(urls: [URL]) {
        guard NetworkMonitor.shared.isConnected else { return }

        let unique = Array(Set(urls))
        guard !unique.isEmpty else { return }

        Task.detached(priority: .background) { [weak self] in
            guard let self else { return }

            for url in unique {
                if Task.isCancelled { return }
                let alreadyCached = await MainActor.run { self.hasImage(for: url) }
                if alreadyCached { continue }
                let connected = await MainActor.run { NetworkMonitor.shared.isConnected }
                if !connected { return }

                do {
                    let (data, response) = try await URLSession.shared.data(from: url)
                    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                        continue
                    }
                    guard let decoded = await RemoteImageDecoder.decode(
                        data: data,
                        response: httpResponse,
                        url: url
                    ) else {
                        continue
                    }
                    await MainActor.run {
                        self.store(decoded.image, data: decoded.cacheData, for: url)
                    }
                } catch {
                    continue
                }
            }
        }
    }

    func clearAll() {
        memoryCache.removeAllObjects()
        queue.sync {
            if fileManager.fileExists(atPath: cacheDirectory.path) {
                try? fileManager.removeItem(at: cacheDirectory)
            }
            try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        }
    }

    func remove(for url: URL) {
        memoryCache.removeObject(forKey: cacheKey(for: url))
        queue.sync {
            let fileURL = diskURL(for: url)
            guard fileManager.fileExists(atPath: fileURL.path) else { return }
            try? fileManager.removeItem(at: fileURL)
        }
    }

    // MARK: - Helpers

    private func cacheKey(for url: URL) -> NSString {
        NSString(string: url.absoluteString)
    }

    private func diskURL(for url: URL) -> URL {
        cacheDirectory.appendingPathComponent(Self.fileName(for: url))
    }

    /// Bumped whenever `RemoteImageDecoder`'s SVG rasterisation changes, so previously
    /// stored (v1: top-left cropped) renders are re-fetched instead of served forever.
    /// Only salts vector URLs — raster card art is unaffected and stays cached.
    private static let svgRenderVersion = 2

    private static func fileName(for url: URL) -> String {
        let identity = url.pathExtension.lowercased() == "svg"
            ? "svg-v\(svgRenderVersion)|\(url.absoluteString)"
            : url.absoluteString
        let digest = SHA256.hash(data: Data(identity.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "\(hex).img"
    }
}
