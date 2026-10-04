package com.ahmadjalil.tcger.data.backup
import java.io.File
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
class PortableBackupMergeTest {
    @Test fun sharedMergePreservesAndMovesPhysicalCopiesWithoutDuplicates() {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }.first { File(it,"mobile-parity/fixtures/portable-backup-merge-v2.json").exists() }
        val fixture = Json.parseToJsonElement(File(root,"mobile-parity/fixtures/portable-backup-merge-v2.json").readText()).jsonObject
        val before = fixture.getValue("before").jsonObject
        val incoming = fixture.getValue("incoming").jsonObject
        val expected = fixture.getValue("expected").jsonObject
        val merged = PortableBackupMerge.merge(before,incoming)
        val binders = merged.getValue("binders").jsonArray
        assertEquals(expected.getValue("binderIDs"), JsonArray(binders.map { it.jsonObject.getValue("id") }))
        val copies = binders.flatMap { it.jsonObject.getValue("cards").jsonArray }
        assertEquals(expected.getValue("copyIDs").jsonArray.toSet(), copies.map { it.jsonObject.getValue("id") }.toSet())
        assertEquals(copies.size, copies.map { it.jsonObject.getValue("id") }.distinct().size)
        assertEquals(expected.getValue("updatedPrice"), copies.first { it.jsonObject.getValue("id") == expected.getValue("updatedCopyID") }.jsonObject.getValue("price"))
        assertEquals(merged,PortableBackupMerge.merge(merged,incoming))
        assertEquals(4,CollectionBackupJson.decode(merged.toString()).importPlan(emptyList()).binders.sumOf {it.cards.size})
    }
}
