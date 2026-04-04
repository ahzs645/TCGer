import SwiftUI

struct SealedInventoryView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var inventory: [SealedInventoryItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingCatalog = false

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading sealed inventory...")
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Retry") { Task { await loadInventory() } }
                            .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if inventory.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "shippingbox")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Sealed Products")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("Track your sealed product inventory")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button {
                            showingCatalog = true
                        } label: {
                            Label("Browse Products", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(inventory) { item in
                            SealedInventoryRow(item: item)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) {
                                        Task { await deleteItem(item) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Sealed Products")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingCatalog = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable { await loadInventory() }
            .task { await loadInventory() }
            .sheet(isPresented: $showingCatalog) {
                SealedProductCatalogSheet(onAdd: { productId, qty, price in
                    Task {
                        await addToInventory(productId: productId, quantity: qty, purchasePrice: price)
                    }
                })
                .environmentObject(environmentStore)
            }
        }
    }

    @MainActor
    private func loadInventory() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        isLoading = inventory.isEmpty
        do {
            inventory = try await apiService.getUserSealedInventory(
                config: environmentStore.serverConfiguration, token: token
            )
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func addToInventory(productId: String, quantity: Int, purchasePrice: Double?) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let item = try await apiService.addSealedInventory(
                config: environmentStore.serverConfiguration, token: token,
                productId: productId, quantity: quantity, purchasePrice: purchasePrice
            )
            inventory.insert(item, at: 0)
            HapticManager.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteItem(_ item: SealedInventoryItem) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteSealedInventory(
                config: environmentStore.serverConfiguration, token: token, itemId: item.id
            )
            inventory.removeAll { $0.id == item.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct SealedInventoryRow: View {
    let item: SealedInventoryItem

    var body: some View {
        HStack(spacing: 12) {
            if let url = item.product.imageUrl, let imageURL = URL(string: url) {
                CachedAsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fit)
                    default:
                        Rectangle().fill(Color(.systemGray5))
                            .overlay(Image(systemName: "shippingbox").foregroundColor(.secondary))
                    }
                }
                .frame(width: 50, height: 50)
                .cornerRadius(6)
            } else {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(.systemGray5))
                    .frame(width: 50, height: 50)
                    .overlay(Image(systemName: "shippingbox").foregroundColor(.secondary))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.product.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Text(item.product.productType.capitalized)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundColor(.accentColor)
                        .cornerRadius(4)

                    Text("Qty: \(item.quantity)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let price = item.purchasePrice {
                    Text("$\(String(format: "%.2f", price))")
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

private struct SealedProductCatalogSheet: View {
    let onAdd: (String, Int, Double?) -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var products: [SealedProduct] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var selectedProduct: SealedProduct?
    @State private var quantity = 1
    @State private var priceText = ""

    private let apiService = APIService()

    private var filteredProducts: [SealedProduct] {
        if searchText.isEmpty { return products }
        let query = searchText.lowercased()
        return products.filter { $0.name.lowercased().contains(query) }
    }

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading products...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if products.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "shippingbox.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No sealed products available")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(filteredProducts) { product in
                        Button {
                            selectedProduct = product
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(product.name)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                    HStack(spacing: 6) {
                                        Text(product.productType.capitalized)
                                            .font(.caption2)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 2)
                                            .background(Color.accentColor.opacity(0.15))
                                            .foregroundColor(.accentColor)
                                            .cornerRadius(4)
                                        if let msrp = product.msrp {
                                            Text("MSRP $\(String(format: "%.2f", msrp))")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                }
                                Spacer()
                                Image(systemName: "plus.circle")
                                    .foregroundColor(.accentColor)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .searchable(text: $searchText, prompt: "Search products")
                }
            }
            .navigationTitle("Product Catalog")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await loadProducts() }
            .alert("Add to Inventory", isPresented: Binding(
                get: { selectedProduct != nil },
                set: { if !$0 { selectedProduct = nil; quantity = 1; priceText = "" } }
            )) {
                TextField("Purchase Price", text: $priceText)
                    .keyboardType(.decimalPad)
                Button("Add") {
                    if let product = selectedProduct {
                        onAdd(product.id, quantity, Double(priceText))
                        selectedProduct = nil
                        quantity = 1
                        priceText = ""
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Add \(selectedProduct?.name ?? "") to your inventory?")
            }
        }
    }

    @MainActor
    private func loadProducts() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        do {
            products = try await apiService.getSealedProducts(
                config: environmentStore.serverConfiguration, token: token
            )
            isLoading = false
        } catch {
            isLoading = false
        }
    }
}
