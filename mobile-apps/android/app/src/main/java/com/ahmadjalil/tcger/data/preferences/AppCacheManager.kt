package com.ahmadjalil.tcger.data.preferences

import android.content.Context
import java.io.File

class AppCacheManager(context: Context) {
    private val cacheDirectory = context.applicationContext.cacheDir

    fun sizeBytes(): Long = cacheDirectory.recursiveSize()

    fun clear(): Boolean = cacheDirectory.listFiles().orEmpty().all(File::deleteRecursively)

    private fun File.recursiveSize(): Long = if (isFile) length() else listFiles().orEmpty().sumOf { it.recursiveSize() }
}
