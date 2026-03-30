import Foundation
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UIKit)
import UIKit
#endif
#if canImport(SwiftUI)
import SwiftUI
#endif
#if canImport(DeveloperToolsSupport)
import DeveloperToolsSupport
#endif

#if SWIFT_PACKAGE
private let resourceBundle = Foundation.Bundle.module
#else
private class ResourceBundleClass {}
private let resourceBundle = Foundation.Bundle(for: ResourceBundleClass.self)
#endif

// MARK: - Color Symbols -

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension DeveloperToolsSupport.ColorResource {

    /// The "LaunchBackground" asset catalog color resource.
    static let launchBackground = DeveloperToolsSupport.ColorResource(name: "LaunchBackground", bundle: resourceBundle)

}

// MARK: - Image Symbols -

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension DeveloperToolsSupport.ImageResource {

    /// The "house" asset catalog image resource.
    static let house = DeveloperToolsSupport.ImageResource(name: "house", bundle: resourceBundle)

    /// The "layers" asset catalog image resource.
    static let layers = DeveloperToolsSupport.ImageResource(name: "layers", bundle: resourceBundle)

    /// The "lore-logo" asset catalog image resource.
    static let loreLogo = DeveloperToolsSupport.ImageResource(name: "lore-logo", bundle: resourceBundle)

    /// The "lore-logo 1" asset catalog image resource.
    static let loreLogo1 = DeveloperToolsSupport.ImageResource(name: "lore-logo 1", bundle: resourceBundle)

    /// The "search" asset catalog image resource.
    static let search = DeveloperToolsSupport.ImageResource(name: "search", bundle: resourceBundle)

    /// The "settings" asset catalog image resource.
    static let settings = DeveloperToolsSupport.ImageResource(name: "settings", bundle: resourceBundle)

    /// The "square-plus" asset catalog image resource.
    static let squarePlus = DeveloperToolsSupport.ImageResource(name: "square-plus", bundle: resourceBundle)

    /// The "user" asset catalog image resource.
    static let user = DeveloperToolsSupport.ImageResource(name: "user", bundle: resourceBundle)

}

// MARK: - Color Symbol Extensions -

#if canImport(AppKit)
@available(macOS 14.0, *)
@available(macCatalyst, unavailable)
extension AppKit.NSColor {

    /// The "LaunchBackground" asset catalog color.
    static var launchBackground: AppKit.NSColor {
#if !targetEnvironment(macCatalyst)
        .init(resource: .launchBackground)
#else
        .init()
#endif
    }

}
#endif

#if canImport(UIKit)
@available(iOS 17.0, tvOS 17.0, *)
@available(watchOS, unavailable)
extension UIKit.UIColor {

    /// The "LaunchBackground" asset catalog color.
    static var launchBackground: UIKit.UIColor {
#if !os(watchOS)
        .init(resource: .launchBackground)
#else
        .init()
#endif
    }

}
#endif

#if canImport(SwiftUI)
@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension SwiftUI.Color {

    /// The "LaunchBackground" asset catalog color.
    static var launchBackground: SwiftUI.Color { .init(.launchBackground) }

}

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension SwiftUI.ShapeStyle where Self == SwiftUI.Color {

    /// The "LaunchBackground" asset catalog color.
    static var launchBackground: SwiftUI.Color { .init(.launchBackground) }

}
#endif

// MARK: - Image Symbol Extensions -

#if canImport(AppKit)
@available(macOS 14.0, *)
@available(macCatalyst, unavailable)
extension AppKit.NSImage {

    /// The "house" asset catalog image.
    static var house: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .house)
#else
        .init()
#endif
    }

    /// The "layers" asset catalog image.
    static var layers: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .layers)
#else
        .init()
#endif
    }

    /// The "lore-logo" asset catalog image.
    static var loreLogo: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .loreLogo)
#else
        .init()
#endif
    }

    /// The "lore-logo 1" asset catalog image.
    static var loreLogo1: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .loreLogo1)
#else
        .init()
#endif
    }

    /// The "search" asset catalog image.
    static var search: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .search)
#else
        .init()
#endif
    }

    /// The "settings" asset catalog image.
    static var settings: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .settings)
#else
        .init()
#endif
    }

    /// The "square-plus" asset catalog image.
    static var squarePlus: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .squarePlus)
#else
        .init()
#endif
    }

    /// The "user" asset catalog image.
    static var user: AppKit.NSImage {
#if !targetEnvironment(macCatalyst)
        .init(resource: .user)
#else
        .init()
#endif
    }

}
#endif

#if canImport(UIKit)
@available(iOS 17.0, tvOS 17.0, *)
@available(watchOS, unavailable)
extension UIKit.UIImage {

    /// The "house" asset catalog image.
    static var house: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .house)
#else
        .init()
#endif
    }

    /// The "layers" asset catalog image.
    static var layers: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .layers)
#else
        .init()
#endif
    }

    /// The "lore-logo" asset catalog image.
    static var loreLogo: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .loreLogo)
#else
        .init()
#endif
    }

    /// The "lore-logo 1" asset catalog image.
    static var loreLogo1: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .loreLogo1)
#else
        .init()
#endif
    }

    /// The "search" asset catalog image.
    static var search: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .search)
#else
        .init()
#endif
    }

    /// The "settings" asset catalog image.
    static var settings: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .settings)
#else
        .init()
#endif
    }

    /// The "square-plus" asset catalog image.
    static var squarePlus: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .squarePlus)
#else
        .init()
#endif
    }

    /// The "user" asset catalog image.
    static var user: UIKit.UIImage {
#if !os(watchOS)
        .init(resource: .user)
#else
        .init()
#endif
    }

}
#endif

// MARK: - Thinnable Asset Support -

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
@available(watchOS, unavailable)
extension DeveloperToolsSupport.ColorResource {

    private init?(thinnableName: Swift.String, bundle: Foundation.Bundle) {
#if canImport(AppKit) && os(macOS)
        if AppKit.NSColor(named: NSColor.Name(thinnableName), bundle: bundle) != nil {
            self.init(name: thinnableName, bundle: bundle)
        } else {
            return nil
        }
#elseif canImport(UIKit) && !os(watchOS)
        if UIKit.UIColor(named: thinnableName, in: bundle, compatibleWith: nil) != nil {
            self.init(name: thinnableName, bundle: bundle)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}

#if canImport(AppKit)
@available(macOS 14.0, *)
@available(macCatalyst, unavailable)
extension AppKit.NSColor {

    private convenience init?(thinnableResource: DeveloperToolsSupport.ColorResource?) {
#if !targetEnvironment(macCatalyst)
        if let resource = thinnableResource {
            self.init(resource: resource)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}
#endif

#if canImport(UIKit)
@available(iOS 17.0, tvOS 17.0, *)
@available(watchOS, unavailable)
extension UIKit.UIColor {

    private convenience init?(thinnableResource: DeveloperToolsSupport.ColorResource?) {
#if !os(watchOS)
        if let resource = thinnableResource {
            self.init(resource: resource)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}
#endif

#if canImport(SwiftUI)
@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension SwiftUI.Color {

    private init?(thinnableResource: DeveloperToolsSupport.ColorResource?) {
        if let resource = thinnableResource {
            self.init(resource)
        } else {
            return nil
        }
    }

}

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension SwiftUI.ShapeStyle where Self == SwiftUI.Color {

    private init?(thinnableResource: DeveloperToolsSupport.ColorResource?) {
        if let resource = thinnableResource {
            self.init(resource)
        } else {
            return nil
        }
    }

}
#endif

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
@available(watchOS, unavailable)
extension DeveloperToolsSupport.ImageResource {

    private init?(thinnableName: Swift.String, bundle: Foundation.Bundle) {
#if canImport(AppKit) && os(macOS)
        if bundle.image(forResource: NSImage.Name(thinnableName)) != nil {
            self.init(name: thinnableName, bundle: bundle)
        } else {
            return nil
        }
#elseif canImport(UIKit) && !os(watchOS)
        if UIKit.UIImage(named: thinnableName, in: bundle, compatibleWith: nil) != nil {
            self.init(name: thinnableName, bundle: bundle)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}

#if canImport(AppKit)
@available(macOS 14.0, *)
@available(macCatalyst, unavailable)
extension AppKit.NSImage {

    private convenience init?(thinnableResource: DeveloperToolsSupport.ImageResource?) {
#if !targetEnvironment(macCatalyst)
        if let resource = thinnableResource {
            self.init(resource: resource)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}
#endif

#if canImport(UIKit)
@available(iOS 17.0, tvOS 17.0, *)
@available(watchOS, unavailable)
extension UIKit.UIImage {

    private convenience init?(thinnableResource: DeveloperToolsSupport.ImageResource?) {
#if !os(watchOS)
        if let resource = thinnableResource {
            self.init(resource: resource)
        } else {
            return nil
        }
#else
        return nil
#endif
    }

}
#endif

