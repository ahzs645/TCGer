import SwiftUI

struct GamePackageCapabilitiesView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var selectedCard: Card?
    let package: InstalledGamePackage
    @ObservedObject var store: GamePackageStore
    @State private var busy: String?
    @State private var error: String?
    @State private var pulls: [CommunityCatalogCard] = []
    @State private var revision = 0

    var body: some View {
        Section("Optional features") {
            if package.manifest.pricing != nil { capabilityButton("pricing", "Price snapshots", ready: store.priceSnapshot(for: package) != nil) }
            if package.manifest.offlinePacks != nil { capabilityButton("packs", "Pack opening", ready: store.packLibrary(for: package) != nil) }
            if package.manifest.scanner?.ios != nil { capabilityButton("scanner", "Scanner", ready: TCGGame(rawValue: package.manifest.game.id).flatMap { ScannerAssetStore.shared.runtime(for: $0) } != nil) }
            if let error { Text(error).foregroundStyle(.red) }
            if let library = store.packLibrary(for: package) {
                ForEach(library.packs) { pack in
                    Button("Open \(pack.name)") {
                        do {
                            let cards = Dictionary(uniqueKeysWithValues: try store.cards(for: package).map { ($0.id, $0) })
                            pulls = try pack.open().compactMap { cards[$0] }
                        } catch { self.error = error.localizedDescription }
                    }
                }
            }
            ForEach(Array(pulls.enumerated()), id: \.offset) { _, card in
                HStack {
                    AsyncImage(url: card.imageUrl.flatMap(URL.init(string:))) { image in image.resizable().scaledToFit() } placeholder: { Rectangle().fill(.quaternary) }.frame(width: 64, height: 90)
                    VStack(alignment: .leading) {
                        Text(card.name)
                        Button("Save to collection") { selectedCard = card.card(gameId: package.manifest.game.id) }
                        if let rarity = card.rarity { Text(rarity).font(.caption).foregroundStyle(.secondary) }
                        if let quote = store.priceSnapshot(for: package)?.quote(cardId: card.id, currency: "USD") {
                            Text(quote.amount, format: .currency(code: quote.currency))
                            Text(quote.source).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }.id(revision)
        .sheet(item: $selectedCard) { card in
            AddCardToBinderSheet(card: card) { selected, binderId, details in
                try await APIService().addCardToBinder(config: environmentStore.serverConfiguration, token: environmentStore.authToken, binderId: binderId, card: selected, details: details)
            }
        }
    }

    private func capabilityButton(_ kind: String, _ label: String, ready: Bool) -> some View {
        Button(ready ? "\(label) ready" : "Enable \(label.lowercased())") {
            busy = kind; error = nil
            Task {
                do { try await store.enableCapability(kind, for: package); revision += 1 }
                catch { self.error = error.localizedDescription }
                busy = nil
            }
        }.disabled(busy != nil || ready)
    }
}

struct GamePackagePriceView: View {
    let card: Card
    var finishCode: String? = nil
    var condition: String? = nil
    var language: String? = nil
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @ObservedObject private var store = GamePackageStore.shared
    var body: some View {
        if environmentStore.showPricing, let packageId = card.gamePresentation?.packageId,
           let package = store.installed.first(where: { $0.id == packageId }), let snapshot = store.priceSnapshot(for: package) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if let quote = snapshot.quote(cardId: card.id, currency: environmentStore.displayCurrencyCode, printingKey: card.printingKey, finishCode: finishCode, condition: condition, language: language, now: context.date) {
                    VStack(alignment: .leading) {
                        Text(quote.amount, format: .currency(code: quote.currency))
                        Text("\(quote.source) · \(quote.observedAt.prefix(10))").font(.caption).foregroundStyle(.secondary)
                    }
                } else { Text("No current price for this variant.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

struct GameCardSymbolsView: View {
    let card: Card
    private var symbols: [GameSymbol] {
        var tokens = Set(card.types ?? [])
        for (key, value) in card.attributes ?? [:] where key != "tcger" {
            switch value {
            case .string(let token): tokens.insert(token)
            case .array(let values): for case .string(let token) in values { tokens.insert(token) }
            default: break
            }
        }
        return card.gamePresentation?.symbols?.filter { $0.kind != "rarity" && tokens.contains($0.id) } ?? []
    }
    var body: some View {
        ForEach(Array(symbols.enumerated()), id: \.offset) { _, symbol in
            HStack {
                AsyncImage(url: URL(string: symbol.imageUrl)) { image in image.resizable().scaledToFit() } placeholder: { EmptyView() }.frame(width: 18, height: 18)
                Text(symbol.label).font(.caption)
            }
        }
    }
}
