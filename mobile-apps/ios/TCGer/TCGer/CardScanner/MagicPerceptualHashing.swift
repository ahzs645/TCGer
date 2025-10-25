import Accelerate
import CoreGraphics
import Foundation

struct MagicCardHashMatch: Hashable, Sendable {
    let entry: CardHashEntry
    let distance: Int

    var confidenceScore: Double {
        let normalized = 1.0 - (Double(distance) / MagicCardHashLibrary.Configuration.qualityCutoff)
        return max(0, min(1, normalized))
    }
}

struct CardHashEntry: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageURLString: String?
    let price: Double?
    let perceptualHash: UInt64

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case setCode
        case setName
        case rarity
        case imageURLString = "imageUrl"
        case price
        case perceptualHash = "hash"
        case fallbackHash = "phash"
    }

    init(
        id: String,
        name: String,
        setCode: String?,
        setName: String?,
        rarity: String?,
        imageURLString: String?,
        price: Double?,
        perceptualHash: UInt64
    ) {
        self.id = id
        self.name = name
        self.setCode = setCode
        self.setName = setName
        self.rarity = rarity
        self.imageURLString = imageURLString
        self.price = price
        self.perceptualHash = perceptualHash
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        setCode = try container.decodeIfPresent(String.self, forKey: .setCode)
        setName = try container.decodeIfPresent(String.self, forKey: .setName)
        rarity = try container.decodeIfPresent(String.self, forKey: .rarity)
        imageURLString = try container.decodeIfPresent(String.self, forKey: .imageURLString)
        price = try container.decodeIfPresent(Double.self, forKey: .price)

        if let stringHash = try? container.decode(String.self, forKey: .perceptualHash) {
            perceptualHash = CardHashEntry.parseHash(stringHash)
        } else if let stringHash = try? container.decode(String.self, forKey: .fallbackHash) {
            perceptualHash = CardHashEntry.parseHash(stringHash)
        } else if let numericHash = try? container.decode(UInt64.self, forKey: .perceptualHash) {
            perceptualHash = numericHash
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .perceptualHash,
                in: container,
                debugDescription: "Unable to parse perceptual hash"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(setCode, forKey: .setCode)
        try container.encodeIfPresent(setName, forKey: .setName)
        try container.encodeIfPresent(rarity, forKey: .rarity)
        try container.encodeIfPresent(imageURLString, forKey: .imageURLString)
        try container.encodeIfPresent(price, forKey: .price)
        try container.encode(String(perceptualHash, radix: 16), forKey: .perceptualHash)
    }

    var imageURL: URL? {
        guard let imageURLString else { return nil }
        if let remoteURL = URL(string: imageURLString), remoteURL.scheme != nil {
            return remoteURL
        }
        return URL(fileURLWithPath: imageURLString)
    }

    func makeDetails() -> CardDetails {
        let identity = CardIdentity(
            id: id,
            name: name,
            game: .magic,
            setCode: setCode,
            setName: setName
        )
        return CardDetails(
            identity: identity,
            rarity: rarity,
            imageURL: imageURL,
            price: price,
            sourceCard: nil
        )
    }

    private static func parseHash(_ string: String) -> UInt64 {
        let sanitized = string
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "0x", with: "")
        return UInt64(sanitized, radix: 16) ?? 0
    }
}

actor MagicCardHashLibrary {
    struct Configuration {
        static let sharedJSONName = "MagicCardHashes"
        static let fileExtension = "json"
        static let maximumMatches = 5
        static let qualityCutoff: Double = 18 // Hamming distance
    }

    static let shared = MagicCardHashLibrary()

    private var entries: [CardHashEntry] = []
    private var isLoaded = false

    func preloadIfNeeded() {
        guard !isLoaded else { return }
        if let cachedWrapper = try? CacheManager.shared.load(
            [CardHashEntry].self,
            forKey: CacheManager.CacheKey.magicCardHashes
        ), let cached = cachedWrapper, !cached.isEmpty {
            entries = cached
            isLoaded = true
            return
        }

        if let url = Bundle.main.url(
            forResource: Configuration.sharedJSONName,
            withExtension: Configuration.fileExtension
        ), let data = try? Data(contentsOf: url) {
            if let decoded = try? JSONDecoder().decode([CardHashEntry].self, from: data) {
                entries = decoded
            }
        }

        isLoaded = !entries.isEmpty
    }

    func isReady() async -> Bool {
        preloadIfNeeded()
        return !entries.isEmpty
    }

    func bestMatches(
        for hash: UInt64,
        limit: Int = Configuration.maximumMatches,
        maxDistance: Int = Int(Configuration.qualityCutoff)
    ) async -> [MagicCardHashMatch] {
        preloadIfNeeded()
        guard !entries.isEmpty else { return [] }
        var matches: [MagicCardHashMatch] = []
        matches.reserveCapacity(limit)

        for entry in entries {
            let distance = PerceptualHash.hammingDistance(hash, entry.perceptualHash)
            guard distance <= maxDistance else { continue }
            matches.append(MagicCardHashMatch(entry: entry, distance: distance))
        }

        matches.sort { $0.distance < $1.distance }
        if matches.count > limit {
            matches.removeSubrange(limit..<matches.count)
        }
        return matches
    }
}

enum PerceptualHash {
    private static let sampleSize = 32
    private static let dctSize = 8

    static func hash(for image: CGImage) -> UInt64 {
        guard let grayscale = Self.makeGrayscaleImage(from: image, size: CGSize(width: sampleSize, height: sampleSize)),
              let data = grayscale.dataProvider?.data,
              let pixels = CFDataGetBytePtr(data)
        else {
            return 0
        }

        var floatPixels = [Float](repeating: 0, count: sampleSize * sampleSize)
        for index in 0..<(sampleSize * sampleSize) {
            floatPixels[index] = Float(pixels[index])
        }

        let dctRows = applyDCT(floatPixels)
        let dct = applyDCTColumns(dctRows)

        var lowFrequencyCoefficients: [Float] = []
        lowFrequencyCoefficients.reserveCapacity(dctSize * dctSize)
        for y in 0..<dctSize {
            for x in 0..<dctSize {
                lowFrequencyCoefficients.append(dct[y * sampleSize + x])
            }
        }

        guard !lowFrequencyCoefficients.isEmpty else { return 0 }
        let dcValue = lowFrequencyCoefficients[0]
        let average = (lowFrequencyCoefficients.reduce(0, +) - dcValue) / Float(lowFrequencyCoefficients.count - 1)

        var hash: UInt64 = 0
        for (index, value) in lowFrequencyCoefficients.enumerated() {
            if value > average {
                hash |= (1 << UInt64(63 - index))
            }
        }
        return hash
    }

    static func hammingDistance(_ lhs: UInt64, _ rhs: UInt64) -> Int {
        (lhs ^ rhs).nonzeroBitCount
    }

    private static func makeGrayscaleImage(from image: CGImage, size: CGSize) -> CGImage? {
        let width = Int(size.width)
        let height = Int(size.height)
        let colorSpace = CGColorSpaceCreateDeviceGray()
        let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        )
        context?.interpolationQuality = .high
        context?.draw(image, in: CGRect(origin: .zero, size: size))
        return context?.makeImage()
    }

    private static func applyDCT(_ input: [Float]) -> [Float] {
        var output = [Float](repeating: 0, count: input.count)
        guard let dctSetup = vDSP.DCT(count: sampleSize, transformType: .II) else {
            return output
        }

        for row in 0..<sampleSize {
            let range = row * sampleSize..<(row + 1) * sampleSize
            var rowInput = Array(input[range])
            var rowOutput = [Float](repeating: 0, count: sampleSize)
            rowInput.withUnsafeMutableBufferPointer { inputBuffer in
                rowOutput.withUnsafeMutableBufferPointer { outputBuffer in
                    guard
                        let inputPointer = inputBuffer.baseAddress,
                        let outputPointer = outputBuffer.baseAddress
                    else { return }
                    dctSetup.transform(inputPointer, result: outputPointer)
                }
            }
            for column in 0..<sampleSize {
                output[row * sampleSize + column] = rowOutput[column]
            }
        }
        return output
    }

    private static func applyDCTColumns(_ input: [Float]) -> [Float] {
        var output = [Float](repeating: 0, count: input.count)
        guard let dctSetup = vDSP.DCT(count: sampleSize, transformType: .II) else {
            return output
        }

        for column in 0..<sampleSize {
            var columnInput = [Float](repeating: 0, count: sampleSize)
            for row in 0..<sampleSize {
                columnInput[row] = input[row * sampleSize + column]
            }

            var columnOutput = [Float](repeating: 0, count: sampleSize)
            columnInput.withUnsafeMutableBufferPointer { inputBuffer in
                columnOutput.withUnsafeMutableBufferPointer { outputBuffer in
                    guard
                        let inputPointer = inputBuffer.baseAddress,
                        let outputPointer = outputBuffer.baseAddress
                    else { return }
                    dctSetup.transform(inputPointer, result: outputPointer)
                }
            }

            for row in 0..<sampleSize {
                output[row * sampleSize + column] = columnOutput[row]
            }
        }

        return output
    }
}
