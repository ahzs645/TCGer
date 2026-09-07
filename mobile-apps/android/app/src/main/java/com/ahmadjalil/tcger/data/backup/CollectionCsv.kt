package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.domain.CollectionDetails
import com.ahmadjalil.tcger.domain.CollectionTag
import java.time.Instant
import java.util.UUID

/** RFC 4180 records, including embedded newlines and escaped quotes. */
fun parseCollectionCsv(raw: String): PortableCollectionBackup {
    val rows = mutableListOf<List<String>>(); val row = mutableListOf<String>(); val cell = StringBuilder()
    var quoted = false; var i = 0
    while (i < raw.length) {
        val ch = raw[i++]
        when {
            ch == '"' && quoted && i < raw.length && raw[i] == '"' -> { cell.append('"'); i++ }
            ch == '"' -> quoted = !quoted
            ch == ',' && !quoted -> { row += cell.toString(); cell.clear() }
            ch == '\n' && !quoted -> { row += cell.toString().removeSuffix("\r"); cell.clear(); rows += row.toList(); row.clear() }
            else -> cell.append(ch)
        }
    }
    require(!quoted) { "CSV has an unclosed quoted field" }
    if (cell.isNotEmpty() || row.isNotEmpty()) { row += cell.toString(); rows += row.toList() }
    require(rows.size > 1) { "CSV is empty" }
    fun normalize(value: String) = value.trim().removePrefix("\uFEFF").lowercase().replace("_", "").replace(" ", "")
    val headers = rows.first().map(::normalize)
    val fingerprint = UUID.nameUUIDFromBytes(raw.toByteArray()).toString()
    val entries = rows.drop(1).filter { it.any(String::isNotBlank) }.mapIndexed { index, cells ->
        fun field(vararg aliases: String): String? = aliases.firstNotNullOfOrNull { alias -> headers.indexOf(normalize(alias)).takeIf { it >= 0 }?.let { cells.getOrNull(it)?.trim()?.takeIf(String::isNotBlank) } }
        fun number(name: String): Double? = field(name)?.let { requireNotNull(it.toDoubleOrNull()) { "Invalid $name on CSV row ${index + 2}" } }
        fun bool(name: String) = field(name)?.lowercase()?.let { require(it in listOf("true", "false", "1", "0", "yes", "no")) { "Invalid $name on CSV row ${index + 2}" }; it in listOf("true", "1", "yes") } ?: false
        val id = requireNotNull(field("externalId", "cardId")) { "CSV row ${index + 2} needs externalId or cardId. Use the export template to preserve exact printings." }
        val game = requireNotNull(field("tcg", "game")) { "CSV row ${index + 2} needs a game" }.lowercase()
        val quantity = field("quantity")?.let { requireNotNull(it.toIntOrNull()) { "Invalid quantity" } } ?: 1
        val details = CollectionDetails(language=field("language"),notes=field("notes"),serialNumber=field("serialNumber"),acquiredAt=field("acquiredAt"),isFoil=bool("isFoil"),finishCode=field("finishCode"),finishLabel=field("finishLabel"),edition=field("edition"),stamp=field("stamp"),isSealedPromo=bool("isSealedPromo"),isOversized=bool("isOversized"),isPeelOff=bool("isPeelOff"),isSigned=bool("isSigned"),isAltered=bool("isAltered"),gradingCompany=field("gradingCompany"),gradingScore=field("gradingScore"),certNumber=field("certNumber"),storageLocation=field("storageLocation"),tags=field("tags")?.split('|')?.filter(String::isNotBlank)?.map { CollectionTag(label=it.trim()) } ?: emptyList())
        (field("binder", "binderName") ?: "Imported cards") to PortableOwnedCard(PortableCard(id, field("name", "card", "cardName") ?: id, game, field("setCode", "set"), collectorNumber=field("collectorNumber")),quantity,field("condition"),number("price"),number("acquisitionPrice"),details,"csv:$fingerprint:$index")
    }
    val backup = PortableCollectionBackup(exportedAt=Instant.now().toString(),binders=entries.groupBy({ it.first }, { it.second }).map { (name, cards) -> PortableBinder(name=name,colorHex="315DA8",cards=cards,id="csv:$fingerprint:$name") },wishlists=emptyList(),sealedInventory=emptyList())
    return CollectionBackupJson.decode(CollectionBackupJson.encode(backup))
}
