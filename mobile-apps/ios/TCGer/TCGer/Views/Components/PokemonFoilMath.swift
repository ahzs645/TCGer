import SwiftUI

func clampValue<T: Comparable>(_ value: T, min minValue: T, max maxValue: T) -> T {
    min(max(value, minValue), maxValue)
}

func adjustValue(_ value: Double, fromMin: Double, fromMax: Double, toMin: Double, toMax: Double) -> Double {
    guard fromMax - fromMin != 0 else { return toMin }
    let progress = (value - fromMin) / (fromMax - fromMin)
    return toMin + (toMax - toMin) * progress
}

extension CGFloat {
    var clampedToUnit: CGFloat { clampValue(self, min: 0, max: 1) }
}

extension Double {
    var clampedToUnit: Double { clampValue(self, min: 0, max: 1) }
}

struct PokemonFoilUniforms {
    let pointer: CGPoint
    let pointerPercent: CGPoint
    let background: CGPoint
    let backgroundPercent: CGPoint
    let pointerFromCenter: Double
    let pointerFromTop: Double
    let pointerFromLeft: Double
    let interactionStrength: Double
    let cardOpacity: Double
    let highlightPoint: UnitPoint
    let randomSeed: CGPoint
    let cosmosBase: CGPoint

    init(pointer: CGPoint, intensity: Double, seed: CGPoint = CGPoint(x: 0.5, y: 0.5), cosmosBase: CGPoint = CGPoint(x: 0.5, y: 0.5)) {
        let clampedPointer = CGPoint(
            x: pointer.x.clampedToUnit,
            y: pointer.y.clampedToUnit
        )

        let percentX = clampedPointer.x * 100
        let percentY = clampedPointer.y * 100
        let backgroundPercentX = adjustValue(Double(percentX), fromMin: 0, fromMax: 100, toMin: 37, toMax: 63)
        let backgroundPercentY = adjustValue(Double(percentY), fromMin: 0, fromMax: 100, toMin: 33, toMax: 67)

        self.pointer = clampedPointer
        self.pointerPercent = CGPoint(x: percentX, y: percentY)
        self.backgroundPercent = CGPoint(x: CGFloat(backgroundPercentX), y: CGFloat(backgroundPercentY))
        self.background = CGPoint(x: CGFloat(backgroundPercentX / 100), y: CGFloat(backgroundPercentY / 100))

        let dx = Double(percentX - 50)
        let dy = Double(percentY - 50)
        let distance = sqrt(dx * dx + dy * dy) / 50
        self.pointerFromCenter = clampValue(distance, min: 0, max: 1)
        self.pointerFromTop = Double(clampedPointer.y)
        self.pointerFromLeft = Double(clampedPointer.x)

        self.interactionStrength = clampValue(intensity, min: 0, max: 1)
        self.cardOpacity = self.interactionStrength
        self.highlightPoint = UnitPoint(x: Double(clampedPointer.x), y: Double(clampedPointer.y))
        self.randomSeed = CGPoint(x: seed.x.clampedToUnit, y: seed.y.clampedToUnit)
        self.cosmosBase = CGPoint(x: cosmosBase.x.clampedToUnit, y: cosmosBase.y.clampedToUnit)
    }
}

extension PokemonFoilUniforms {
    func backgroundShift(x factorX: Double, y factorY: Double) -> UnitPoint {
        let shiftedX = (((0.5 - Double(background.x)) * factorX) + 0.5).clampedToUnit
        let shiftedY = (((0.5 - Double(background.y)) * factorY) + 0.5).clampedToUnit
        return UnitPoint(x: shiftedX, y: shiftedY)
    }

    var primaryGradientStart: UnitPoint {
        backgroundShift(x: 2.6, y: 3.5)
    }

    var primaryGradientEnd: UnitPoint {
        let x = ((0.5 - Double(background.x)) * -0.9) + 0.5 - (Double(background.y) * 0.75)
        let y = Double(background.y)
        return UnitPoint(x: x.clampedToUnit, y: y.clampedToUnit)
    }

    var secondaryGradientStart: UnitPoint {
        let x = ((0.5 - Double(background.x)) * 1.65) + 0.5 + (Double(background.y) * 0.5)
        let y = Double(background.x)
        return UnitPoint(x: x.clampedToUnit, y: y.clampedToUnit)
    }

    var secondaryGradientEnd: UnitPoint {
        let x = ((0.5 - Double(background.x)) * -1.2) + 0.5 - (Double(background.y) * 0.3)
        let y = Double(background.y)
        return UnitPoint(x: x.clampedToUnit, y: y.clampedToUnit)
    }

    var backgroundOffsetY: CGFloat {
        background.y - 0.5
    }
}

private func foilHash(_ bytes: [UInt8], salt: UInt64) -> UInt64 {
    var hash = salt
    for byte in bytes {
        hash ^= UInt64(byte)
        hash &*= 0x100000001b3
    }
    return hash
}

private func normalizedSeed(from hash: UInt64) -> CGPoint {
    let mask: UInt64 = 0xFFFF
    let xComponent = Double(hash & mask) / Double(mask)
    let yComponent = Double((hash >> 16) & mask) / Double(mask)
    return CGPoint(x: xComponent, y: yComponent)
}

func pokemonFoilSeeds(for identifier: String) -> (seed: CGPoint, cosmos: CGPoint) {
    let bytes = Array(identifier.utf8)
    let primaryHash = foilHash(bytes, salt: 0x9E3779B97F4A7C15)
    let secondaryHash = foilHash(Array(bytes.reversed()), salt: 0xC2B2AE3D27D4EB4F)
    return (normalizedSeed(from: primaryHash), normalizedSeed(from: secondaryHash))
}
