import Foundation

/// Import merges stable record IDs; recovery/explicit replacement remains a
/// separate operation. Incoming metadata wins, unrelated records survive.
enum PortableBackupMerge {
    static func merge(_ before: [String: Any], _ incoming: [String: Any]) -> [String: Any] {
        var result = before.merging(incoming) { _, new in new }
        for section in ["binders", "wishlists"] {
            let after = incoming[section] as? [[String: Any]] ?? []
            let movedIDs = Set(after.flatMap { ($0["cards"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String } })
            let old = (before[section] as? [[String: Any]] ?? []).filter { !($0["id"] as? String == "__library__" && ($0["cards"] as? [[String: Any]] ?? []).isEmpty) }.map { record -> [String: Any] in
                var record = record
                record["cards"] = (record["cards"] as? [[String: Any]] ?? []).filter { !movedIDs.contains($0["id"] as? String ?? "") }
                return record
            }
            result[section] = rows(old, after, mergeChildren: true)
        }
        result["sealedInventory"] = rows(before["sealedInventory"] as? [[String: Any]] ?? [], incoming["sealedInventory"] as? [[String: Any]] ?? [])
        var sections = before["sections"] as? [String: Any] ?? [:]
        for (key, value) in incoming["sections"] as? [String: Any] ?? [:] {
            if ["transactions", "onlineCodes", "smartFolders", "binderPages"].contains(key), let after = value as? [[String: Any]] {
                sections[key] = rows(sections[key] as? [[String: Any]] ?? [], after)
            } else if ["binderPageImages", "copyImages", "preferences"].contains(key), let after = value as? [String: Any] {
                sections[key] = (sections[key] as? [String: Any] ?? [:]).merging(after) { _, new in new }
            } else { sections[key] = value }
        }
        result["sections"] = sections
        return result
    }
    private static func rows(_ before: [[String: Any]], _ after: [[String: Any]], mergeChildren: Bool = false) -> [[String: Any]] {
        var result = before
        for incoming in after {
            guard let id = incoming["id"] as? String, let index = result.firstIndex(where: { $0["id"] as? String == id }) else { result.append(incoming); continue }
            var record = result[index].merging(incoming) { _, new in new }
            if mergeChildren { record["cards"] = rows(result[index]["cards"] as? [[String: Any]] ?? [], incoming["cards"] as? [[String: Any]] ?? []) }
            result[index] = record
        }
        return result
    }
}
