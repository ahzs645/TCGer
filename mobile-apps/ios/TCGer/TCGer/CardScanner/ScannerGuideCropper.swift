import CoreGraphics

/// Maps the visible scanner guide through an aspect-fill camera preview and
/// crops the corresponding pixels from an upright camera image.
struct ScannerGuideGeometry: Equatable, Sendable {
    let previewFrame: CGRect
    let guideFrame: CGRect
}

struct ScannerGuideCropper {
    nonisolated init() {}

    nonisolated func crop(_ image: CGImage, using geometry: ScannerGuideGeometry) -> CGImage? {
        guard let cropRect = imageCropRect(
            imageSize: CGSize(width: image.width, height: image.height),
            geometry: geometry
        ) else {
            return nil
        }
        return image.cropping(to: cropRect)
    }

    nonisolated func imageCropRect(
        imageSize: CGSize,
        geometry: ScannerGuideGeometry
    ) -> CGRect? {
        guard imageSize.width > 0,
              imageSize.height > 0,
              geometry.previewFrame.width > 0,
              geometry.previewFrame.height > 0
        else {
            return nil
        }

        let visibleGuide = geometry.guideFrame.intersection(geometry.previewFrame)
        guard !visibleGuide.isNull, visibleGuide.width > 1, visibleGuide.height > 1 else {
            return nil
        }

        let guideInPreview = visibleGuide.offsetBy(
            dx: -geometry.previewFrame.minX,
            dy: -geometry.previewFrame.minY
        )
        let scale = max(
            geometry.previewFrame.width / imageSize.width,
            geometry.previewFrame.height / imageSize.height
        )
        guard scale.isFinite, scale > 0 else { return nil }

        let renderedSize = CGSize(
            width: imageSize.width * scale,
            height: imageSize.height * scale
        )
        let renderedOrigin = CGPoint(
            x: (geometry.previewFrame.width - renderedSize.width) / 2,
            y: (geometry.previewFrame.height - renderedSize.height) / 2
        )

        var cropRect = CGRect(
            x: (guideInPreview.minX - renderedOrigin.x) / scale,
            y: (guideInPreview.minY - renderedOrigin.y) / scale,
            width: guideInPreview.width / scale,
            height: guideInPreview.height / scale
        ).standardized

        let imageBounds = CGRect(origin: .zero, size: imageSize)
        cropRect = cropRect.intersection(imageBounds).integral
        guard !cropRect.isNull, cropRect.width > 1, cropRect.height > 1 else {
            return nil
        }
        return cropRect
    }
}
