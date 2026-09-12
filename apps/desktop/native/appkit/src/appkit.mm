#import <AppKit/AppKit.h>

#include <node_api.h>

// Electron sets NSMenu.autoenablesItems = NO and only refreshes items it owns
// (representedObject). AppKit injects Start Dictation with action startDictation:;
// that item is not in Electron's menu model, so enabled must be set here.

static bool SpiritSetMenuItemEnabledByAction(NSMenu *menu, SEL action, BOOL enabled) {
  if (menu == nil) {
    return false;
  }
  for (NSMenuItem *item in menu.itemArray) {
    if (item.action == action) {
      item.enabled = enabled;
      return true;
    }
    if (item.hasSubmenu && SpiritSetMenuItemEnabledByAction(item.submenu, action, enabled)) {
      return true;
    }
  }
  return false;
}

static bool SpiritSetStartDictationMenuEnabled(bool enabled) {
  SEL action = NSSelectorFromString(@"startDictation:");
  __block bool found = false;
  void (^apply)(void) = ^{
    found = SpiritSetMenuItemEnabledByAction(NSApp.mainMenu, action, enabled ? YES : NO);
  };
  if ([NSThread isMainThread]) {
    apply();
  } else {
    dispatch_sync(dispatch_get_main_queue(), apply);
  }
  return found;
}

static napi_value SpiritSetStartDictationMenuEnabledNapi(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  bool enabled = false;
  if (argc >= 1) {
    napi_get_value_bool(env, args[0], &enabled);
  }

  napi_value result;
  napi_get_boolean(env, SpiritSetStartDictationMenuEnabled(enabled), &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "setStartDictationMenuEnabled", NAPI_AUTO_LENGTH,
                       SpiritSetStartDictationMenuEnabledNapi, nullptr, &fn);
  napi_set_named_property(env, exports, "setStartDictationMenuEnabled", fn);
  return exports;
}
