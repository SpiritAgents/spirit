{
  "targets": [
    {
      "target_name": "spirit_desktop_appkit",
      "sources": ["src/appkit.mm"],
      "xcode_settings": {
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"]
      },
      "link_settings": {
        "libraries": ["-framework AppKit", "-framework Foundation"]
      }
    }
  ]
}
