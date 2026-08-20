import SwiftUI

struct CurrencySettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var currencies = SupportedCurrency.fallback
    @State private var searchText = ""
    @State private var isLoadingCurrencies = false
    @State private var currencyListError: String?

    private var filteredCurrencies: [SupportedCurrency] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return currencies }
        return currencies.filter {
            $0.isoCode.localizedCaseInsensitiveContains(query) ||
                $0.name.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            Section("Current Display") {
                LabeledContent("Currency", value: environmentStore.displayCurrencyCode)

                if environmentStore.displayCurrencyCode == "USD" {
                    Text("Market values are stored in USD, so no conversion is needed.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let cached = environmentStore.exchangeRate {
                    LabeledContent("Reference rate") {
                        Text(referenceRateText(cached.exchangeRate))
                            .monospacedDigit()
                    }
                    LabeledContent("Rate date", value: cached.exchangeRate.date)
                    LabeledContent("Source", value: cached.providerName)

                    Button {
                        Task { await environmentStore.refreshExchangeRate(force: true) }
                    } label: {
                        if environmentStore.isRefreshingExchangeRate {
                            HStack {
                                ProgressView()
                                Text("Refreshing…")
                            }
                        } else {
                            Label("Refresh Exchange Rate", systemImage: "arrow.clockwise")
                        }
                    }
                    .disabled(environmentStore.isRefreshingExchangeRate)
                } else if environmentStore.isRefreshingExchangeRate {
                    HStack {
                        ProgressView()
                        Text("Loading exchange rate…")
                    }
                }

                if let error = environmentStore.exchangeRateError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            Section {
                if isLoadingCurrencies && currencies == SupportedCurrency.fallback {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                }

                ForEach(filteredCurrencies) { currency in
                    Button {
                        environmentStore.displayCurrencyCode = currency.isoCode
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(currency.name)
                                    .foregroundStyle(.primary)
                                Text([currency.isoCode, currency.symbol]
                                    .compactMap { $0 }
                                    .joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if environmentStore.displayCurrencyCode == currency.isoCode {
                                Image(systemName: "checkmark")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(.tint)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("displayCurrency.\(currency.isoCode)")
                }

                if filteredCurrencies.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                }
            } header: {
                Text("Choose Currency")
            } footer: {
                Text(currencyListError ?? "Converted values are estimates for display only. Your saved prices remain in their original currency.")
            }
        }
        .navigationTitle("Display Currency")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Currency name or code")
        .task {
            await loadCurrencies()
        }
    }

    @MainActor
    private func loadCurrencies() async {
        isLoadingCurrencies = true
        currencyListError = nil
        defer { isLoadingCurrencies = false }
        do {
            currencies = try await CurrencyConverter.shared.supportedCurrencies()
        } catch is CancellationError {
            return
        } catch {
            currencyListError = "The full currency list is unavailable. Common currencies are still shown."
        }
    }

    private func referenceRateText(_ rate: ExchangeRate) -> String {
        let formattedRate = rate.rate.formatted(
            .number.precision(.fractionLength(2...6))
        )
        return "1 \(rate.base) = \(formattedRate) \(rate.quote)"
    }
}
