import SwiftUI
import Vision
import VisionKit

struct SealedBarcodeScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onBarcode: (String) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported,
                   DataScannerViewController.isAvailable {
                    SealedBarcodeDataScanner { barcode in
                        onBarcode(barcode)
                        dismiss()
                    }
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .bottom) {
                        Text("Center the UPC or EAN barcode in the viewfinder")
                            .font(.callout.weight(.medium))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding()
                    }
                } else {
                    ContentUnavailableView(
                        "Barcode Scanner Unavailable",
                        systemImage: "barcode.viewfinder",
                        description: Text("This device cannot run the live barcode scanner.")
                    )
                }
            }
            .navigationTitle("Scan Sealed Product")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

private struct SealedBarcodeDataScanner: UIViewControllerRepresentable {
    let onBarcode: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onBarcode: onBarcode)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [
                .barcode(symbologies: [.ean8, .ean13, .upce])
            ],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        guard !controller.isScanning else { return }
        try? controller.startScanning()
    }

    static func dismantleUIViewController(
        _ controller: DataScannerViewController,
        coordinator: Coordinator
    ) {
        controller.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onBarcode: (String) -> Void
        private var hasReportedBarcode = false

        init(onBarcode: @escaping (String) -> Void) {
            self.onBarcode = onBarcode
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !hasReportedBarcode else { return }
            for item in addedItems {
                guard case .barcode(let barcode) = item,
                      let payload = barcode.payloadStringValue,
                      !payload.isEmpty
                else { continue }
                hasReportedBarcode = true
                onBarcode(payload)
                return
            }
        }
    }
}

struct ScannedSealedProductSheet: View {
    @Environment(\.dismiss) private var dismiss
    let product: SealedProduct
    let onAdd: (Int, Double?) -> Void

    @State private var quantity = 1
    @State private var purchasePrice = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Matched Product") {
                    Text(product.name)
                        .font(.headline)
                    LabeledContent("Game", value: product.tcg.capitalized)
                    LabeledContent("Type", value: product.productType.capitalized)
                    if let upc = product.upc {
                        LabeledContent("Barcode", value: upc)
                    }
                    if let msrp = product.msrp {
                        LabeledContent("MSRP", value: msrp.priceText)
                    }
                }

                Section("Inventory") {
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...999)
                    TextField("Purchase price (optional)", text: $purchasePrice)
                        .keyboardType(.decimalPad)
                }
            }
            .navigationTitle("Add Sealed Product")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        onAdd(quantity, Double(purchasePrice))
                        dismiss()
                    }
                }
            }
        }
    }
}
