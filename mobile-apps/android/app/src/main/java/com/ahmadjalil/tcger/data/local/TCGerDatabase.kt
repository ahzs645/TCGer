package com.ahmadjalil.tcger.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [BinderEntity::class, OwnedCardEntity::class, WishlistEntity::class, WishlistCardEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class TCGerDatabase : RoomDatabase() {
    abstract fun dao(): TCGerDao

    companion object {
        fun create(context: Context): TCGerDatabase = Room.databaseBuilder(
            context,
            TCGerDatabase::class.java,
            "tcger.db",
        ).build()
    }
}
