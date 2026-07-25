import Foundation

/// CSV import for phone-only mode.
///
/// With a backend the server parses and resolves the file; on-device there is
/// no server, so this mirrors the same contract locally: parse the CSV, report
/// per-row issues, merge duplicate rows, and resolve each card against an
/// installed catalog when one is available.
///
/// It accepts the server's `tcger-import-template.csv` headers (snake_case) as
/// well as the headers this app writes when exporting a collection, so an
/// export can be re-imported without editing.
enum CollectionCSVImporter {
    struct ParsedRow {
        let row: APIService.CollectionImportRow
        let card: Card
        let binderName: String?
        let finishCode: String?
        let tags: [String]
    }

    struct Parsed {
        let rows: [ParsedRow]
        let issues: [APIService.CollectionImportIssue]
        let sourceRows: Int

        var totalCopies: Int {
            rows.reduce(0) { $0 + $1.row.quantity }
        }

        /// Matches the server: nothing imports while any row still has a problem.
        var valid: Bool {
            issues.isEmpty && !rows.isEmpty
        }
    }

    static func parse(csv: String) -> Parsed {
        let records = parseRecords(csv)
        guard let header = records.first else {
            return Parsed(
                rows: [],
                issues: [issue(row: 0, field: nil, message: "The file is empty.")],
                sourceRows: 0
            )
        }

        let columns = columnIndex(for: header)
        guard columns[.cardName] != nil || columns[.externalId] != nil else {
            return Parsed(
                rows: [],
                issues: [
                    issue(
                        row: 1,
                        field: "card_name",
                        message: "No card name column found. Expected a header row containing 'card_name' or 'name'."
                    )
                ],
                sourceRows: 0
            )
        }

        var issues: [APIService.CollectionImportIssue] = []
        var merged: [String: ParsedRow] = [:]
        var order: [String] = []
        var sourceRows = 0

        for (offset, record) in records.dropFirst().enumerated() {
            let rowNumber = offset + 2  // 1-based, and the header is row 1
            guard record.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else {
                continue
            }
            sourceRows += 1

            switch parseRow(record, columns: columns, rowNumber: rowNumber) {
            case .failure(let rowIssues):
                issues.append(contentsOf: rowIssues)
            case .success(let parsed):
                let key = mergeKey(for: parsed)
                if let existing = merged[key] {
                    merged[key] = combine(existing, with: parsed)
                } else {
                    merged[key] = parsed
                    order.append(key)
                }
            }
        }

        return Parsed(
            rows: order.compactMap { merged[$0] },
            issues: issues,
            sourceRows: sourceRows
        )
    }

    // MARK: - Row parsing

    private enum Column: CaseIterable {
        case tcg, externalId, cardName, collectorNumber, setCode, setName, rarity
        case binderName, quantity, condition, language, notes, price, acquisitionPrice
        case serialNumber, acquiredAt, isFoil, finishCode, isSigned, isAltered, tags

        /// Normalized header spellings this column accepts.
        var aliases: [String] {
            switch self {
            case .tcg: return ["tcg", "game"]
            case .externalId: return ["externalid", "cardid", "id"]
            case .cardName: return ["cardname", "name", "card"]
            case .collectorNumber: return ["collectornumber", "cardnumber", "number", "no"]
            case .setCode: return ["setcode", "set", "expansion"]
            case .setName: return ["setname"]
            case .rarity: return ["rarity"]
            case .binderName: return ["bindername", "binder", "collection", "folder"]
            case .quantity: return ["quantity", "qty", "count", "copies"]
            case .condition: return ["condition"]
            case .language: return ["language", "lang"]
            case .notes: return ["notes", "note", "comment", "comments"]
            case .price: return ["price", "value", "marketprice"]
            case .acquisitionPrice: return ["acquisitionprice", "purchaseprice", "paidprice", "paid", "cost"]
            case .serialNumber: return ["serialnumber", "serial"]
            case .acquiredAt: return ["acquiredat", "purchasedate", "acquired", "datepurchased"]
            case .isFoil: return ["isfoil", "foil", "holo", "isholo"]
            case .finishCode: return ["finishcode", "finish"]
            case .isSigned: return ["issigned", "signed"]
            case .isAltered: return ["isaltered", "altered"]
            case .tags: return ["tags", "tag", "labels"]
            }
        }
    }

    private static func columnIndex(for header: [String]) -> [Column: Int] {
        var index: [Column: Int] = [:]
        for (position, raw) in header.enumerated() {
            let normalized = normalizeHeader(raw)
            guard !normalized.isEmpty else { continue }
            for column in Column.allCases where index[column] == nil {
                if column.aliases.contains(normalized) {
                    index[column] = position
                    break
                }
            }
        }
        return index
    }

    private static func normalizeHeader(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\u{FEFF}", with: "")
            .filter { $0.isLetter || $0.isNumber }
    }

    private enum RowOutcome {
        case success(ParsedRow)
        case failure([APIService.CollectionImportIssue])
    }

    private static func parseRow(
        _ record: [String],
        columns: [Column: Int],
        rowNumber: Int
    ) -> RowOutcome {
        func value(_ column: Column) -> String? {
            guard let position = columns[column], position < record.count else { return nil }
            let trimmed = record[position].trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        var rowIssues: [APIService.CollectionImportIssue] = []

        let externalId = value(.externalId)
        let name = value(.cardName) ?? externalId
        guard let cardName = name else {
            rowIssues.append(issue(row: rowNumber, field: "card_name", message: "Card name is required."))
            return .failure(rowIssues)
        }

        guard let rawTcg = value(.tcg) else {
            rowIssues.append(issue(row: rowNumber, field: "tcg", message: "Game (tcg) is required."))
            return .failure(rowIssues)
        }

        guard let game = game(from: rawTcg) else {
            rowIssues.append(
                issue(
                    row: rowNumber,
                    field: "tcg",
                    message: "\"\(rawTcg)\" is not a supported game. Use pokemon, magic, yugioh, onepiece, lorcana, or dragonball."
                )
            )
            return .failure(rowIssues)
        }

        var quantity = 1
        if let rawQuantity = value(.quantity) {
            guard let parsed = Int(rawQuantity), parsed > 0 else {
                rowIssues.append(
                    issue(row: rowNumber, field: "quantity", message: "Quantity must be a whole number of 1 or more.")
                )
                return .failure(rowIssues)
            }
            quantity = parsed
        }

        let price = decimal(value(.price))
        if value(.price) != nil, price == nil {
            rowIssues.append(issue(row: rowNumber, field: "price", message: "Price is not a number."))
        }

        let acquisitionPrice = decimal(value(.acquisitionPrice))
        if value(.acquisitionPrice) != nil, acquisitionPrice == nil {
            rowIssues.append(
                issue(row: rowNumber, field: "acquisition_price", message: "Acquisition price is not a number.")
            )
        }

        guard rowIssues.isEmpty else { return .failure(rowIssues) }

        let collectorNumber = value(.collectorNumber)
        let setCode = value(.setCode)
        let setName = value(.setName)
        let rarity = value(.rarity)
        let isFoil = boolean(value(.isFoil)) ?? false
        let finishCode = value(.finishCode) ?? (isFoil ? "holo" : nil)
        let tags = (value(.tags).map(splitTags) ?? [])

        let card = resolveCard(
            name: cardName,
            game: game,
            externalId: externalId,
            collectorNumber: collectorNumber,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            price: price
        )

        let row = APIService.CollectionImportRow(
            row: rowNumber,
            tcg: game.rawValue,
            externalId: card.id,
            cardName: card.name,
            setCode: card.setCode ?? setCode,
            setName: card.setName ?? setName,
            rarity: card.rarity ?? rarity,
            binderName: value(.binderName),
            quantity: quantity,
            condition: value(.condition),
            language: value(.language),
            notes: value(.notes),
            price: price ?? card.price,
            acquisitionPrice: acquisitionPrice,
            serialNumber: value(.serialNumber),
            acquiredAt: value(.acquiredAt),
            isFoil: PokemonFinishOption.isFoil(finishCode),
            isSigned: boolean(value(.isSigned)) ?? false,
            isAltered: boolean(value(.isAltered)) ?? false,
            tags: tags
        )

        return .success(
            ParsedRow(
                row: row,
                card: card,
                binderName: value(.binderName),
                finishCode: finishCode,
                tags: tags
            )
        )
    }

    // MARK: - Merging

    private static func mergeKey(for parsed: ParsedRow) -> String {
        let row = parsed.row
        return [
            row.binderName?.lowercased() ?? "",
            row.tcg,
            row.externalId,
            row.condition?.lowercased() ?? "",
            row.language?.lowercased() ?? "",
            parsed.finishCode?.lowercased() ?? "",
            row.isSigned ? "signed" : "",
            row.isAltered ? "altered" : ""
        ].joined(separator: "|")
    }

    private static func combine(_ existing: ParsedRow, with addition: ParsedRow) -> ParsedRow {
        let row = existing.row
        let combined = APIService.CollectionImportRow(
            row: row.row,
            tcg: row.tcg,
            externalId: row.externalId,
            cardName: row.cardName,
            setCode: row.setCode,
            setName: row.setName,
            rarity: row.rarity,
            binderName: row.binderName,
            quantity: row.quantity + addition.row.quantity,
            condition: row.condition,
            language: row.language,
            notes: row.notes ?? addition.row.notes,
            price: row.price ?? addition.row.price,
            acquisitionPrice: row.acquisitionPrice ?? addition.row.acquisitionPrice,
            serialNumber: row.serialNumber ?? addition.row.serialNumber,
            acquiredAt: row.acquiredAt ?? addition.row.acquiredAt,
            isFoil: row.isFoil,
            isSigned: row.isSigned,
            isAltered: row.isAltered,
            tags: Array(Set(row.tags + addition.row.tags)).sorted()
        )
        return ParsedRow(
            row: combined,
            card: existing.card,
            binderName: existing.binderName,
            finishCode: existing.finishCode,
            tags: combined.tags
        )
    }

    // MARK: - Card resolution

    /// Prefer a real catalog card (correct id, artwork, set data) and fall back
    /// to a synthesized card so an import never fails just because the catalog
    /// for that game is not installed.
    private static func resolveCard(
        name: String,
        game: TCGGame,
        externalId: String?,
        collectorNumber: String?,
        setCode: String?,
        setName: String?,
        rarity: String?,
        price: Double?
    ) -> Card {
        let store = CatalogStore.shared
        if store.isLoaded(game) {
            let matches = store.search(query: name, tcg: game, limit: 25).map(store.card(from:))

            if let externalId,
               let exact = matches.first(where: { $0.id == externalId }) {
                return exact
            }
            if let collectorNumber,
               let byNumber = matches.first(where: {
                   $0.collectorNumber?.caseInsensitiveCompare(collectorNumber) == .orderedSame
                       && (setCode == nil || $0.setCode?.caseInsensitiveCompare(setCode!) == .orderedSame)
               }) {
                return byNumber
            }
            if let setCode,
               let bySet = matches.first(where: {
                   $0.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
                       && $0.name.caseInsensitiveCompare(name) == .orderedSame
               }) {
                return bySet
            }
            if let byName = matches.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
                return byName
            }
        }

        let back = game.cardBackAssetName
        return Card(
            id: externalId ?? syntheticId(name: name, game: game, setCode: setCode, collectorNumber: collectorNumber),
            name: name,
            tcg: game.rawValue,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            imageUrl: back,
            imageUrlSmall: back,
            price: price,
            collectorNumber: collectorNumber,
            releasedAt: nil
        )
    }

    /// Stable id so re-importing the same file merges into the same card
    /// instead of creating duplicates.
    private static func syntheticId(
        name: String,
        game: TCGGame,
        setCode: String?,
        collectorNumber: String?
    ) -> String {
        let parts = [game.rawValue, name, setCode ?? "", collectorNumber ?? ""]
        let slug = parts
            .joined(separator: "-")
            .lowercased()
            .map { $0.isLetter || $0.isNumber ? $0 : "-" }
            .reduce(into: "") { partial, character in
                if character == "-", partial.hasSuffix("-") { return }
                partial.append(character)
            }
        return "import-\(slug.trimmingCharacters(in: CharacterSet(charactersIn: "-")))"
    }

    // MARK: - Value helpers

    private static func game(from raw: String) -> TCGGame? {
        let normalized = raw
            .lowercased()
            .folding(options: [.diacriticInsensitive], locale: nil)
            .filter { $0.isLetter || $0.isNumber }

        switch normalized {
        case "pokemon", "pkmn", "ptcg": return .pokemon
        case "magic", "mtg", "magicthegathering": return .magic
        case "yugioh", "ygo", "yugiohtcg": return .yugioh
        case "onepiece", "op", "optcg": return .onepiece
        case "lorcana", "disneylorcana": return .lorcana
        case "dragonball", "dbs", "dragonballsuper", "dbscg": return .dragonball
        default: return TCGGame(rawValue: normalized).flatMap { $0 == .all ? nil : $0 }
        }
    }

    private static func boolean(_ raw: String?) -> Bool? {
        guard let raw = raw?.lowercased() else { return nil }
        switch raw {
        case "true", "yes", "y", "1", "foil", "holo": return true
        case "false", "no", "n", "0", "": return false
        default: return nil
        }
    }

    private static func decimal(_ raw: String?) -> Double? {
        guard let raw else { return nil }

        // Drop currency symbols and spaces, keeping only separators and digits.
        let cleaned = raw.filter { $0.isNumber || $0 == "." || $0 == "," || $0 == "-" }
        guard cleaned.contains(where: \.isNumber) else { return nil }

        let lastDot = cleaned.lastIndex(of: ".")
        let lastComma = cleaned.lastIndex(of: ",")

        // Whichever separator comes last is the decimal point ("1.234,56" and
        // "1,234.56" are the same number); a lone comma with one or two digits
        // behind it is also a decimal point ("4,50"), otherwise it groups
        // thousands ("1,299").
        let decimalSeparator: Character?
        switch (lastDot, lastComma) {
        case let (dot?, comma?):
            decimalSeparator = dot > comma ? "." : ","
        case (.some, .none):
            decimalSeparator = "."
        case (.none, let comma?):
            let trailingDigits = cleaned.distance(from: cleaned.index(after: comma), to: cleaned.endIndex)
            decimalSeparator = (1...2).contains(trailingDigits) ? "," : nil
        case (.none, .none):
            decimalSeparator = nil
        }

        var normalized = ""
        for character in cleaned {
            if character == decimalSeparator {
                normalized.append(".")
            } else if character == "." || character == "," {
                continue
            } else {
                normalized.append(character)
            }
        }

        return Double(normalized)
    }

    private static func splitTags(_ raw: String) -> [String] {
        raw
            .split(whereSeparator: { $0 == ";" || $0 == "|" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func issue(
        row: Int,
        field: String?,
        message: String
    ) -> APIService.CollectionImportIssue {
        APIService.CollectionImportIssue(row: row, field: field, message: message)
    }

    // MARK: - CSV tokenizer

    /// Split CSV text into records of fields, honoring quoted fields (including
    /// embedded commas, quotes, and newlines) and both LF and CRLF endings.
    ///
    /// This walks unicode scalars rather than characters on purpose: Swift
    /// treats CRLF as a single `Character`, so a character-based scan silently
    /// fails to split records in files exported by Windows tools and Excel.
    static func parseRecords(_ csv: String) -> [[String]] {
        var records: [[String]] = []
        var fields: [String] = []
        var field = String.UnicodeScalarView()
        var inQuotes = false
        var iterator = csv.unicodeScalars.makeIterator()
        var pending: Unicode.Scalar?

        func finishField() {
            fields.append(String(field))
            field = String.UnicodeScalarView()
        }

        func finishRecord() {
            finishField()
            records.append(fields)
            fields = []
        }

        while let scalar = pending ?? iterator.next() {
            pending = nil

            if inQuotes {
                if scalar == "\"" {
                    if let next = iterator.next() {
                        if next == "\"" {
                            field.append("\"")
                        } else {
                            inQuotes = false
                            pending = next
                        }
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(scalar)
                }
                continue
            }

            switch scalar {
            case "\"":
                inQuotes = true
            case ",":
                finishField()
            case "\r":
                // Consume the LF of a CRLF pair; a lone CR still ends the record.
                if let next = iterator.next(), next != "\n" {
                    pending = next
                }
                finishRecord()
            case "\n":
                finishRecord()
            default:
                field.append(scalar)
            }
        }

        if !field.isEmpty || !fields.isEmpty {
            finishRecord()
        }

        return records
    }
}
