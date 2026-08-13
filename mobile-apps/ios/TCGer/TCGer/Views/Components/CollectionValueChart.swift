import Charts
import Foundation
import SwiftUI

enum CollectionValueChartSupport {
    static func selectedIndex(forPlotX plotX: Double, pointCount: Int) -> Int? {
        guard pointCount > 0, plotX.isFinite else { return nil }
        return min(max(Int(plotX.rounded()), 0), pointCount - 1)
    }

    static func displayDate(
        _ rawValue: String,
        monthStyle: Date.FormatStyle.Symbol.Month = .abbreviated
    ) -> String {
        guard let date = date(from: rawValue) else { return rawValue }
        return date.formatted(.dateTime.month(monthStyle).day().year())
    }

    private static func date(from rawValue: String) -> Date? {
        let dayParts = rawValue.prefix(10).split(separator: "-", omittingEmptySubsequences: false)
        if dayParts.count == 3,
           let year = Int(dayParts[0]),
           let month = Int(dayParts[1]),
           let day = Int(dayParts[2]) {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            let components = DateComponents(year: year, month: month, day: day)
            if let date = calendar.date(from: components),
               calendar.dateComponents([.year, .month, .day], from: date) == components {
                return date
            }
        }
        return ISO8601DateFormatter().date(from: rawValue)
    }
}

struct CollectionValueChart: View {
    let points: [CollectionValuePoint]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var isScrubbing = false
    @State private var selectedIndex: Int?

    private var indexedPoints: [(offset: Int, element: CollectionValuePoint)] {
        Array(points.enumerated())
    }

    private var selectedPoint: CollectionValuePoint? {
        guard let selectedIndex, points.indices.contains(selectedIndex) else { return nil }
        return points[selectedIndex]
    }

    private var feedbackPoint: CollectionValuePoint? {
        selectedPoint ?? points.last
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppSpacing.medium) {
            feedback

            Chart {
                ForEach(indexedPoints, id: \.offset) { index, point in
                    AreaMark(
                        x: .value("Date", Double(index)),
                        y: .value("Value", point.value)
                    )
                    .foregroundStyle(.tint.opacity(0.18))

                    LineMark(
                        x: .value("Date", Double(index)),
                        y: .value("Value", point.value)
                    )
                    .foregroundStyle(.tint)
                    .interpolationMethod(.catmullRom)
                }

                if let selectedIndex, let selectedPoint {
                    RuleMark(x: .value("Selected date", Double(selectedIndex)))
                        .foregroundStyle(.secondary.opacity(0.7))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))

                    PointMark(
                        x: .value("Selected date", Double(selectedIndex)),
                        y: .value("Selected value", selectedPoint.value)
                    )
                    .symbolSize(80)
                    .foregroundStyle(.tint)
                }
            }
            .chartXScale(domain: 0 ... Double(max(points.count - 1, 1)))
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: min(points.count, 4))) { value in
                    AxisGridLine()
                    AxisTick()
                    AxisValueLabel {
                        if let rawIndex = value.as(Double.self) {
                            let index = min(max(Int(rawIndex.rounded()), 0), points.count - 1)
                            Text(CollectionValueChartSupport.displayDate(points[index].date))
                        }
                    }
                }
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .gesture(scrubGesture(proxy: proxy, geometry: geometry))
                }
            }
            .frame(height: 210)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Collection value history")
            .accessibilityValue(accessibilityValue)
            .accessibilityHint("Swipe up or down to move between dates.")
            .accessibilityAdjustableAction { direction in
                adjustSelection(direction)
            }
        }
        .onChange(of: isScrubbing) { wasScrubbing, nowScrubbing in
            if wasScrubbing, !nowScrubbing {
                selectedIndex = nil
            }
        }
        .onChange(of: points) {
            selectedIndex = nil
        }
        .onDisappear {
            selectedIndex = nil
        }
    }

    private var feedback: some View {
        HStack(alignment: .center, spacing: AppSpacing.small) {
            StatBlock(
                title: feedbackPoint.map { CollectionValueChartSupport.displayDate($0.date) } ?? "No date",
                value: feedbackPoint?.value.priceText ?? "—",
                alignment: .leading
            )
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: selectedIndex)

            Spacer(minLength: AppSpacing.small)

            StatusPill(
                title: selectedPoint == nil ? "Latest" : "Exploring",
                systemImage: selectedPoint == nil ? "clock" : "hand.draw"
            )
        }
    }

    private var accessibilityValue: String {
        guard let feedbackPoint else { return "No values" }
        return "\(CollectionValueChartSupport.displayDate(feedbackPoint.date)), \(feedbackPoint.value.priceText)"
    }

    private func scrubGesture(proxy: ChartProxy, geometry: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($isScrubbing) { _, state, _ in
                state = true
            }
            .onChanged { value in
                guard let plotFrame = proxy.plotFrame else { return }
                let frame = geometry[plotFrame]
                let plotX = min(max(value.location.x - frame.minX, 0), frame.width)
                guard let chartX = proxy.value(atX: plotX, as: Double.self),
                      let index = CollectionValueChartSupport.selectedIndex(
                          forPlotX: chartX,
                          pointCount: points.count
                      )
                else { return }
                select(index)
            }
    }

    private func adjustSelection(_ direction: AccessibilityAdjustmentDirection) {
        guard !points.isEmpty else { return }
        let current = selectedIndex ?? (points.count - 1)
        switch direction {
        case .increment:
            select(min(current + 1, points.count - 1))
        case .decrement:
            select(max(current - 1, 0))
        @unknown default:
            break
        }
    }

    private func select(_ index: Int) {
        guard points.indices.contains(index), selectedIndex != index else { return }
        selectedIndex = index
        HapticManager.selection()
    }
}
