package com.ahmadjalil.tcger.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        BinderEntity::class,
        OwnedCardEntity::class,
        WishlistEntity::class,
        WishlistCardEntity::class,
        SealedProductEntity::class,
        SealedInventoryEntity::class,
        SealedOpeningEntity::class,
    ],
    version = 3,
    exportSchema = true,
)
abstract class TCGerDatabase : RoomDatabase() {
    abstract fun dao(): TCGerDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE binders ADD COLUMN defaultCondition TEXT")
                db.execSQL("ALTER TABLE binders ADD COLUMN containerType TEXT")
                db.execSQL("ALTER TABLE binders ADD COLUMN imageUrl TEXT")
                db.execSQL("ALTER TABLE binders ADD COLUMN associatedTcg TEXT")
                db.execSQL("ALTER TABLE binders ADD COLUMN associatedSetCode TEXT")
                db.execSQL("ALTER TABLE binders ADD COLUMN associatedSetName TEXT")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `sealed_products` (`id` TEXT NOT NULL, `tcg` TEXT NOT NULL, `name` TEXT NOT NULL, `productType` TEXT NOT NULL, `setCode` TEXT, `cardsPerPack` INTEGER, `packsPerBox` INTEGER, `releaseDate` TEXT, `imageUrl` TEXT, `msrp` REAL, `upc` TEXT, `isCustom` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_products_tcg` ON `sealed_products` (`tcg`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_products_name` ON `sealed_products` (`name`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_products_upc` ON `sealed_products` (`upc`)")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `sealed_inventory` (`id` TEXT NOT NULL, `productId` TEXT NOT NULL, `quantity` INTEGER NOT NULL, `purchasePrice` REAL, `purchaseDate` TEXT, `notes` TEXT, `createdAt` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`productId`) REFERENCES `sealed_products`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_inventory_productId` ON `sealed_inventory` (`productId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_inventory_createdAt` ON `sealed_inventory` (`createdAt`)")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `sealed_openings` (`id` TEXT NOT NULL, `inventoryId` TEXT NOT NULL, `productId` TEXT NOT NULL, `productName` TEXT NOT NULL, `openedQuantity` INTEGER NOT NULL, `openedAt` TEXT NOT NULL, `notes` TEXT, `invested` REAL NOT NULL, `linkedCollectionIds` TEXT NOT NULL, `createdAt` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`productId`) REFERENCES `sealed_products`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_openings_productId` ON `sealed_openings` (`productId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_sealed_openings_openedAt` ON `sealed_openings` (`openedAt`)")
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE wishlists ADD COLUMN matchAnyPrinting INTEGER NOT NULL DEFAULT 0")
            }
        }

        fun create(context: Context): TCGerDatabase = Room.databaseBuilder(
            context,
            TCGerDatabase::class.java,
            "tcger.db",
        ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build()
    }
}
