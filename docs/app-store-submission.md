# TCGer App Store submission sheet

Last audited: August 10, 2026

## Build identity

- App: `firstform.TCGer`
- Widget: `firstform.TCGer.TCGerWidgets`
- Version: `1.0`
- Local project build: `1`; Xcode Cloud currently auto-increments uploads (latest observed: `153`)
- Minimum OS: iOS/iPadOS 26.0
- Encryption: exempt; `ITSAppUsesNonExemptEncryption` is `false`

## Product page draft

- Name: **TCGer**
- Subtitle (27 characters): **Scan, organize, value cards**
- Primary category: **Lifestyle**
- Secondary category: **Utilities**
- Privacy policy URL: `https://tcger.ahmadjalil.com/privacy/`
- Support URL: `https://tcger.ahmadjalil.com/support/`
- Marketing URL: `https://tcger.ahmadjalil.com/`
- Keywords (94 bytes): `trading cards,collection,scanner,binder,wishlist,decks,inventory,card values,catalog,organizer`

### Description

TCGer helps trading-card collectors scan, organize, and understand their collections.

Keep everything on your iPhone or iPad, or connect to a TCGer server you trust for account-based sync. Build binders and wishlists, search card catalogs, record condition and acquisition details, track sealed products and transactions, and review collection values from one place.

Features include:

- On-device card and binder-page scanning
- Phone-only storage with no account required
- Optional self-hosted server mode
- Binders, tags, wishlists, decks, and collection guides
- Sealed inventory and opening records
- Purchase, sale, and value tracking
- Home Screen widgets for collection summaries
- Data export and in-app account deletion

Card availability, images, and pricing depend on external catalog providers and may vary by game or region. TCGer is an independent collection utility and is not affiliated with card-game publishers.

## App privacy answers

Select **Yes, we collect data** because optional server mode can retain data. Declare each item below as **linked to the user**, **not used for tracking**, and used only for **App Functionality**:

- Contact Info → Email Address
- Identifiers → User ID
- User Content → Other User Content
- User Content → Photos or Videos
- Financial Info → Other Financial Info

Do not declare advertising, developer marketing, analytics, or tracking unless the shipped app or server behavior changes. Phone-only collection data remains on the device, but App Store answers must cover the optional server mode too.

## Screenshots

The universal app needs both sets:

- The current App Store Connect record requests iPhone 6.5-inch media: one to ten screenshots at 1242 × 2688 or 1284 × 2778 portrait.
- iPad 13-inch: one to ten screenshots; use 2064 × 2752 or 2048 × 2732 portrait.
- PNG or JPEG only; no alpha channel.

Suggested sequence: Dashboard, Card Scanner, Binder, Wishlist, Collection Analytics. Show phone-only mode so screenshots do not expose private server or account data.

## App Review information draft

**Sign-in required:** No. Reviewers can choose **Keep Everything on This Phone** during setup and use the app without an account.

**Notes:**

> TCGer can run entirely on-device without registration. On first launch, choose “Keep Everything on This Phone.” Camera access is optional and is used only for scanning cards and binder pages. Local-network access is optional and appears only when a reviewer chooses to connect to a self-hosted TCGer server. Face ID is optional and appears only when biometric lock is enabled. Optional server accounts can be permanently deleted from Settings → Delete Server Account after entering the current password.

If Apple needs the optional server flow tested, provide a non-expiring review server URL and demo credentials in the private App Review fields. Never put credentials in the public description or support page.

## Decisions and account tasks still required

- Add a public support email (and any legally required address/phone) to the support page before deployment.
- Confirm the copyright owner text, for example `2026 <legal person or entity name>`.
- Complete the age-rating questionnaire.
- Answer Content Rights accurately and retain permission evidence for third-party card names, images, logos, and catalog data.
- Set Digital Services Act trader status and any required contact verification.
- Choose price, regions, and manual or automatic release.
- Ensure Agreements, Tax, and Banking have no blocking actions in App Store Connect.
- Keep Xcode Cloud signing enabled for the app, widget, and App Group. A local Apple Distribution certificate is optional unless uploading from this Mac.
- Deploy the privacy/support pages, upload a signed build, attach screenshots, select the build, and submit for review.

Apple references: [platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information), [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), and [manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).
