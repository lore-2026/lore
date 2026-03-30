#import <Foundation/Foundation.h>

#if __has_attribute(swift_private)
#define AC_SWIFT_PRIVATE __attribute__((swift_private))
#else
#define AC_SWIFT_PRIVATE
#endif

/// The resource bundle ID.
static NSString * const ACBundleID AC_SWIFT_PRIVATE = @"com.pookies.Lore";

/// The "LaunchBackground" asset catalog color resource.
static NSString * const ACColorNameLaunchBackground AC_SWIFT_PRIVATE = @"LaunchBackground";

/// The "house" asset catalog image resource.
static NSString * const ACImageNameHouse AC_SWIFT_PRIVATE = @"house";

/// The "layers" asset catalog image resource.
static NSString * const ACImageNameLayers AC_SWIFT_PRIVATE = @"layers";

/// The "lore-logo" asset catalog image resource.
static NSString * const ACImageNameLoreLogo AC_SWIFT_PRIVATE = @"lore-logo";

/// The "lore-logo 1" asset catalog image resource.
static NSString * const ACImageNameLoreLogo1 AC_SWIFT_PRIVATE = @"lore-logo 1";

/// The "search" asset catalog image resource.
static NSString * const ACImageNameSearch AC_SWIFT_PRIVATE = @"search";

/// The "square-plus" asset catalog image resource.
static NSString * const ACImageNameSquarePlus AC_SWIFT_PRIVATE = @"square-plus";

/// The "user" asset catalog image resource.
static NSString * const ACImageNameUser AC_SWIFT_PRIVATE = @"user";

#undef AC_SWIFT_PRIVATE
