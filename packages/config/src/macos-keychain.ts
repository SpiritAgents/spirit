import koffi from "koffi";

const SPIRIT_KEYCHAIN_ACCESS_GROUP_SUFFIX = ".dev.spirit.shared";
const CF_STRING_ENCODING_UTF8 = 0x08000100;
const ERR_SEC_ITEM_NOT_FOUND = -25300;

type CFRef = object;

interface CoreFoundationScope {
  own<T extends CFRef | null>(reference: T): T;
  string(value: string): CFRef;
  data(value: Buffer): CFRef;
  dictionary(entries: ReadonlyArray<readonly [CFRef, CFRef]>): CFRef;
}

let bindings: ReturnType<typeof loadBindings> | undefined;
let cachedAccessGroup: string | null | undefined;

function loadBindings() {
  const security = koffi.load("/System/Library/Frameworks/Security.framework/Security");
  const core = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const pointer = (library: typeof security, name: string): CFRef =>
    koffi.decode(library.symbol(name, "void *"), "void *") as CFRef;
  return {
    release: core.func("CFRelease", "void", ["void *"]),
    getTypeId: core.func("CFGetTypeID", "uint64_t", ["void *"]),
    arrayGetTypeId: core.func("CFArrayGetTypeID", "uint64_t", []),
    arrayGetCount: core.func("CFArrayGetCount", "intptr_t", ["void *"]),
    arrayGetValueAtIndex: core.func("CFArrayGetValueAtIndex", "void *", ["void *", "intptr_t"]),
    dataGetBytePointer: core.func("CFDataGetBytePtr", "void *", ["void *"]),
    dataGetLength: core.func("CFDataGetLength", "intptr_t", ["void *"]),
    dictionaryCreateMutable: core.func("CFDictionaryCreateMutable", "void *", [
      "void *",
      "intptr_t",
      "void *",
      "void *",
    ]),
    dictionarySetValue: core.func("CFDictionarySetValue", "void", ["void *", "void *", "void *"]),
    dictionaryGetValue: core.func("CFDictionaryGetValue", "void *", ["void *", "void *"]),
    stringCreate: core.func("CFStringCreateWithCString", "void *", [
      "void *",
      "string",
      "uint32_t",
    ]),
    stringGetLength: core.func("CFStringGetLength", "intptr_t", ["void *"]),
    stringGetMaximumSize: core.func("CFStringGetMaximumSizeForEncoding", "intptr_t", [
      "intptr_t",
      "uint32_t",
    ]),
    stringGetCString: core.func("CFStringGetCString", "bool", [
      "void *",
      "void *",
      "intptr_t",
      "uint32_t",
    ]),
    dataCreate: core.func("CFDataCreate", "void *", ["void *", "void *", "intptr_t"]),
    copySelf: security.func("SecCodeCopySelf", "int32_t", ["uint32_t", koffi.out("void **")]),
    copySigningInformation: security.func("SecCodeCopySigningInformation", "int32_t", [
      "void *",
      "uint32_t",
      koffi.out("void **"),
    ]),
    itemCopyMatching: security.func("SecItemCopyMatching", "int32_t", [
      "void *",
      koffi.out("void **"),
    ]),
    itemAdd: security.func("SecItemAdd", "int32_t", ["void *", "void *"]),
    itemDelete: security.func("SecItemDelete", "int32_t", ["void *"]),
    constants: {
      codeInfoEntitlements: pointer(security, "kSecCodeInfoEntitlementsDict"),
      secClass: pointer(security, "kSecClass"),
      secClassGenericPassword: pointer(security, "kSecClassGenericPassword"),
      secAttrService: pointer(security, "kSecAttrService"),
      secAttrAccount: pointer(security, "kSecAttrAccount"),
      secAttrAccessGroup: pointer(security, "kSecAttrAccessGroup"),
      secUseDataProtectionKeychain: pointer(security, "kSecUseDataProtectionKeychain"),
      secReturnData: pointer(security, "kSecReturnData"),
      secValueData: pointer(security, "kSecValueData"),
      trueValue: pointer(core, "kCFBooleanTrue"),
    },
  };
}

function api() {
  bindings ??= loadBindings();
  return bindings;
}

function assertStatus(operation: string, status: number): void {
  if (status !== 0) {
    throw new Error(`${operation} failed with OSStatus ${status}`);
  }
}

function withCoreFoundation<T>(run: (scope: CoreFoundationScope) => T): T {
  const b = api();
  const owned: CFRef[] = [];
  const own = <T extends CFRef | null>(reference: T): T => {
    if (reference) owned.push(reference);
    return reference;
  };
  const string = (value: string): CFRef => {
    const reference = own(b.stringCreate(null, value, CF_STRING_ENCODING_UTF8) as CFRef | null);
    if (!reference) throw new Error("CFStringCreateWithCString failed");
    return reference;
  };
  const data = (value: Buffer): CFRef => {
    const reference = own(b.dataCreate(null, value, value.length) as CFRef | null);
    if (!reference) throw new Error("CFDataCreate failed");
    return reference;
  };
  const dictionary = (entries: ReadonlyArray<readonly [CFRef, CFRef]>): CFRef => {
    const reference = own(b.dictionaryCreateMutable(null, 0, null, null) as CFRef | null);
    if (!reference) throw new Error("CFDictionaryCreateMutable failed");
    for (const [key, value] of entries) {
      b.dictionarySetValue(reference, key, value);
    }
    return reference;
  };
  try {
    return run({ own, string, data, dictionary });
  } finally {
    for (const reference of owned.reverse()) {
      b.release(reference);
    }
  }
}

function stringValue(reference: CFRef): string {
  const b = api();
  const length = Number(b.stringGetLength(reference));
  const size = Number(b.stringGetMaximumSize(length, CF_STRING_ENCODING_UTF8)) + 1;
  const buffer = Buffer.alloc(size);
  if (!b.stringGetCString(reference, buffer, buffer.length, CF_STRING_ENCODING_UTF8)) {
    throw new Error("CFStringGetCString failed");
  }
  return buffer.toString("utf8", 0, buffer.indexOf(0));
}

export function selectSpiritKeychainAccessGroup(groups: readonly string[]): string | undefined {
  return groups.find((group) => group.endsWith(SPIRIT_KEYCHAIN_ACCESS_GROUP_SUFFIX));
}

function readSignedKeychainAccessGroups(): string[] {
  return withCoreFoundation((scope) => {
    const b = api();
    const codeOutput: unknown[] = [null];
    assertStatus("SecCodeCopySelf", b.copySelf(0, codeOutput));
    const code = scope.own(codeOutput[0] as CFRef);
    const informationOutput: unknown[] = [null];
    assertStatus(
      "SecCodeCopySigningInformation",
      b.copySigningInformation(code, 0, informationOutput),
    );
    const information = scope.own(informationOutput[0] as CFRef);
    const entitlements = b.dictionaryGetValue(
      information,
      b.constants.codeInfoEntitlements,
    ) as CFRef | null;
    if (!entitlements) return [];
    const groups = b.dictionaryGetValue(
      entitlements,
      scope.string("keychain-access-groups"),
    ) as CFRef | null;
    if (!groups || b.getTypeId(groups) !== b.arrayGetTypeId()) return [];
    const count = Number(b.arrayGetCount(groups));
    const values: string[] = [];
    for (let index = 0; index < count; index += 1) {
      values.push(stringValue(b.arrayGetValueAtIndex(groups, index) as CFRef));
    }
    return values;
  });
}

/** The access group comes from this process's signature, never from mutable process environment. */
export function sharedMacKeychainAccessGroup(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  if (cachedAccessGroup === undefined) {
    cachedAccessGroup = selectSpiritKeychainAccessGroup(readSignedKeychainAccessGroups()) ?? null;
  }
  return cachedAccessGroup ?? undefined;
}

function sharedQuery(
  scope: CoreFoundationScope,
  service: string,
  account: string,
  accessGroup: string,
): CFRef {
  const b = api();
  return scope.dictionary([
    [b.constants.secClass, b.constants.secClassGenericPassword],
    [b.constants.secAttrService, scope.string(service)],
    [b.constants.secAttrAccount, scope.string(account)],
    [b.constants.secAttrAccessGroup, scope.string(accessGroup)],
    [b.constants.secUseDataProtectionKeychain, b.constants.trueValue],
  ]);
}

export function getSharedMacKeychainPassword(service: string, account: string): string | undefined {
  const accessGroup = sharedMacKeychainAccessGroup();
  if (!accessGroup) throw new Error("The process has no Spirit keychain access group");
  return withCoreFoundation((scope) => {
    const b = api();
    const query = scope.dictionary([
      [b.constants.secClass, b.constants.secClassGenericPassword],
      [b.constants.secAttrService, scope.string(service)],
      [b.constants.secAttrAccount, scope.string(account)],
      [b.constants.secAttrAccessGroup, scope.string(accessGroup)],
      [b.constants.secUseDataProtectionKeychain, b.constants.trueValue],
      [b.constants.secReturnData, b.constants.trueValue],
    ]);
    const output: unknown[] = [null];
    const status = b.itemCopyMatching(query, output) as number;
    if (status === ERR_SEC_ITEM_NOT_FOUND) return undefined;
    assertStatus("SecItemCopyMatching", status);
    const data = scope.own(output[0] as CFRef | null);
    if (!data) return undefined;
    const length = Number(b.dataGetLength(data));
    if (length === 0) return "";
    const bytes = Buffer.from(koffi.view(b.dataGetBytePointer(data) as CFRef, length));
    return bytes.toString("utf8");
  });
}

export function addSharedMacKeychainPassword(
  service: string,
  account: string,
  password: string,
): void {
  const accessGroup = sharedMacKeychainAccessGroup();
  if (!accessGroup) throw new Error("The process has no Spirit keychain access group");
  withCoreFoundation((scope) => {
    const b = api();
    const query = sharedQuery(scope, service, account, accessGroup);
    b.dictionarySetValue(query, b.constants.secValueData, scope.data(Buffer.from(password)));
    assertStatus("SecItemAdd", b.itemAdd(query, null) as number);
  });
}

export function deleteSharedMacKeychainPassword(service: string, account: string): void {
  const accessGroup = sharedMacKeychainAccessGroup();
  if (!accessGroup) throw new Error("The process has no Spirit keychain access group");
  withCoreFoundation((scope) => {
    const status = api().itemDelete(sharedQuery(scope, service, account, accessGroup)) as number;
    if (status !== ERR_SEC_ITEM_NOT_FOUND) assertStatus("SecItemDelete", status);
  });
}
