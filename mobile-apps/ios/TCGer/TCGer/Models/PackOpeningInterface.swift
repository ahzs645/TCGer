import Foundation

struct PackOpeningInterfaceState: Codable, Equatable {
    enum Phase: String, Codable {
        case loading, select, tear, opening, reveal, summary, final
    }

    enum OpeningMode: String, Codable {
        case normal, quick
    }

    struct PackOption: Codable, Equatable, Identifiable {
        struct OddsReference: Codable, Equatable {
            let title: String
            let url: String
            let sampleSize: Int
            let note: String

            var destination: URL? { URL(string: url) }
        }

        let id: String
        let label: String
        let setID: String?
        let setLabel: String?
        let variationLabel: String?
        let oddsReference: OddsReference?

        var resolvedSetID: String { setID ?? id }
        var resolvedSetLabel: String { setLabel ?? label }
        var resolvedVariationLabel: String { variationLabel ?? label }
    }

    struct PackSet: Equatable, Identifiable {
        let id: String
        let label: String
        let options: [PackOption]
    }

    let phase: Phase
    let selectedPackID: String
    let selectedPackLabel: String
    let packCount: Int
    let openingMode: OpeningMode
    let packBackwards: Bool
    let currentCardFaceUp: Bool
    let packOptions: [PackOption]
    let revealedCount: Int
    let totalCards: Int
    let currentPackNumber: Int
    let totalPacks: Int
    let canSave: Bool
    let warning: String?
    let session: PackOpeningPullSession?

    static let loading = Self(
        phase: .loading,
        selectedPackID: "",
        selectedPackLabel: "Loading",
        packCount: 1,
        openingMode: .normal,
        packBackwards: false,
        currentCardFaceUp: true,
        packOptions: [],
        revealedCount: 0,
        totalCards: 0,
        currentPackNumber: 0,
        totalPacks: 0,
        canSave: false,
        warning: nil,
        session: nil
    )

    var showsNativeResults: Bool {
        (phase == .summary || phase == .final) && session != nil
    }

    var packSets: [PackSet] {
        var order: [String] = []
        var labels: [String: String] = [:]
        var grouped: [String: [PackOption]] = [:]

        for option in packOptions {
            let setID = option.resolvedSetID
            if grouped[setID] == nil { order.append(setID) }
            labels[setID] = option.resolvedSetLabel
            grouped[setID, default: []].append(option)
        }

        return order.map { id in
            PackSet(id: id, label: labels[id] ?? id, options: grouped[id] ?? [])
        }
    }

    var selectedPackOption: PackOption? {
        packOptions.first { $0.id == selectedPackID }
    }

    var selectedSetLabel: String {
        selectedPackOption?.resolvedSetLabel ?? selectedPackLabel
    }

    var selectedSetID: String {
        selectedPackOption?.resolvedSetID ?? selectedPackID
    }

    var selectedSetOptions: [PackOption] {
        guard let selectedPackOption else { return [] }
        return packOptions.filter { $0.resolvedSetID == selectedPackOption.resolvedSetID }
    }

    var selectedOddsReference: PackOption.OddsReference? {
        selectedPackOption?.oddsReference
    }

    var selectedVariationLabel: String {
        selectedPackOption?.resolvedVariationLabel ?? selectedPackLabel
    }

    var selectedPackDisplayLabel: String {
        "\(selectedSetLabel) · \(selectedVariationLabel)"
    }

    var subtitle: String {
        switch phase {
        case .loading: "Loading"
        case .select: selectedPackLabel
        case .tear: "Tear the seal"
        case .opening: "Opening pack"
        case .reveal: "Reveal \(revealedCount) of \(totalCards)"
        case .summary: "Pack results"
        case .final: "\(totalPacks) pack results"
        }
    }
}

struct PackOpeningCommand: Equatable {
    enum Action: String {
        case selectPack, setPackCount, setOpeningMode, togglePackOrientation, openPack, backToPacks, advance, showAll, savePulls, uploadArtwork
    }

    let id = UUID()
    let action: Action
    var optionID: String?
    var count: Int?
    var mode: String?
    var dataURL: String?
    var label: String?

    var payload: [String: Any] {
        var value: [String: Any] = ["type": action.rawValue]
        if let optionID { value["id"] = optionID }
        if let count { value["count"] = count }
        if let mode { value["mode"] = mode }
        if let dataURL { value["dataURL"] = dataURL }
        if let label { value["label"] = label }
        return value
    }

    static func selectPack(_ id: String) -> Self { .init(action: .selectPack, optionID: id) }
    static func setPackCount(_ count: Int) -> Self { .init(action: .setPackCount, count: count) }
    static func setOpeningMode(_ mode: PackOpeningInterfaceState.OpeningMode) -> Self {
        .init(action: .setOpeningMode, mode: mode.rawValue)
    }
    static var togglePackOrientation: Self { .init(action: .togglePackOrientation) }
    static var openPack: Self { .init(action: .openPack) }
    static var backToPacks: Self { .init(action: .backToPacks) }
    static var advance: Self { .init(action: .advance) }
    static var showAll: Self { .init(action: .showAll) }
    static var savePulls: Self { .init(action: .savePulls) }
    static func uploadArtwork(dataURL: String, label: String) -> Self {
        .init(action: .uploadArtwork, dataURL: dataURL, label: label)
    }
}

enum PackOpeningBridgeEvent: Equatable {
    case ready
    case phaseChanged(String)
    case interfaceState(PackOpeningInterfaceState)
    case haptic(String)
    case saveRequested(PackOpeningPullSession)
    case inspectRequested(PackOpeningPull)
    case error(String)
}

