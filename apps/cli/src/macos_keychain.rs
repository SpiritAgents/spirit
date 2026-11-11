use anyhow::{Result, anyhow};
use core_foundation::{
    base::{CFType, TCFType},
    boolean::CFBoolean,
    data::{CFData, CFDataRef},
    dictionary::{CFDictionary, CFDictionaryRef},
    string::{CFString, CFStringRef},
};
use core_foundation_sys::{
    array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef},
    base::{CFGetTypeID, CFTypeRef, OSStatus},
    dictionary::CFDictionaryGetValue,
};
use security_framework::{
    item::{ItemAddOptions, ItemAddValue, ItemClass, Location, add_item},
    os::macos::code_signing::{Flags, SecCode},
};
use security_framework_sys::{
    code_signing::SecCodeRef,
    item::{
        kSecAttrAccessGroup, kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword,
        kSecReturnData, kSecUseDataProtectionKeychain,
    },
    keychain_item::{SecItemCopyMatching, SecItemDelete},
};
use std::{ptr, sync::OnceLock};

const SPIRIT_KEYCHAIN_ACCESS_GROUP_SUFFIX: &str = ".dev.spirit.shared";
const ERR_SEC_ITEM_NOT_FOUND: OSStatus = -25300;

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecCodeInfoEntitlementsDict: CFStringRef;
    fn SecCodeCopySigningInformation(
        code: SecCodeRef,
        flags: u32,
        information: *mut CFDictionaryRef,
    ) -> OSStatus;
}

fn constant_string(reference: CFStringRef) -> CFString {
    unsafe { CFString::wrap_under_get_rule(reference) }
}

fn constant_type(reference: CFTypeRef) -> CFType {
    unsafe { CFType::wrap_under_get_rule(reference) }
}

fn select_spirit_access_group(groups: &[String]) -> Option<String> {
    groups
        .iter()
        .find(|group| group.ends_with(SPIRIT_KEYCHAIN_ACCESS_GROUP_SUFFIX))
        .cloned()
}

fn read_signed_access_groups() -> Result<Vec<String>> {
    let code = SecCode::for_self(Flags::NONE).map_err(|error| anyhow!(error))?;
    let mut information_ref: CFDictionaryRef = ptr::null();
    let status = unsafe {
        SecCodeCopySigningInformation(code.as_concrete_TypeRef(), 0, &mut information_ref)
    };
    if status != 0 {
        return Err(anyhow!(
            "SecCodeCopySigningInformation failed with OSStatus {status}"
        ));
    }
    let information: CFDictionary =
        unsafe { CFDictionary::wrap_under_create_rule(information_ref) };
    let entitlements_ref = unsafe {
        CFDictionaryGetValue(
            information.as_concrete_TypeRef(),
            constant_string(kSecCodeInfoEntitlementsDict)
                .as_concrete_TypeRef()
                .cast(),
        )
    } as CFDictionaryRef;
    if entitlements_ref.is_null() {
        return Ok(Vec::new());
    }
    let entitlements: CFDictionary = unsafe { CFDictionary::wrap_under_get_rule(entitlements_ref) };
    let groups_ref = unsafe {
        CFDictionaryGetValue(
            entitlements.as_concrete_TypeRef(),
            CFString::new("keychain-access-groups")
                .as_concrete_TypeRef()
                .cast(),
        )
    } as CFArrayRef;
    if groups_ref.is_null()
        || unsafe { CFGetTypeID(groups_ref.cast()) } != unsafe { CFArrayGetTypeID() }
    {
        return Ok(Vec::new());
    }
    let count = unsafe { CFArrayGetCount(groups_ref) };
    let mut groups = Vec::with_capacity(count as usize);
    for index in 0..count {
        let value = unsafe { CFArrayGetValueAtIndex(groups_ref, index) } as CFStringRef;
        groups.push(unsafe { CFString::wrap_under_get_rule(value) }.to_string());
    }
    Ok(groups)
}

pub(crate) fn shared_access_group() -> Option<&'static str> {
    static ACCESS_GROUP: OnceLock<Option<String>> = OnceLock::new();
    ACCESS_GROUP
        .get_or_init(|| {
            select_spirit_access_group(&read_signed_access_groups().unwrap_or_default())
        })
        .as_deref()
}

fn query(
    service: &str,
    account: &str,
    access_group: &str,
    return_data: bool,
) -> CFDictionary<CFString, CFType> {
    let mut pairs = vec![
        (unsafe { constant_string(kSecClass) }, unsafe {
            constant_type(kSecClassGenericPassword.cast())
        }),
        (
            unsafe { constant_string(kSecAttrService) },
            CFString::new(service).as_CFType(),
        ),
        (
            unsafe { constant_string(kSecAttrAccount) },
            CFString::new(account).as_CFType(),
        ),
        (
            unsafe { constant_string(kSecAttrAccessGroup) },
            CFString::new(access_group).as_CFType(),
        ),
        (
            unsafe { constant_string(kSecUseDataProtectionKeychain) },
            CFBoolean::true_value().as_CFType(),
        ),
    ];
    if return_data {
        pairs.push((
            unsafe { constant_string(kSecReturnData) },
            CFBoolean::true_value().as_CFType(),
        ));
    }
    CFDictionary::from_CFType_pairs(&pairs)
}

pub(crate) fn get_shared_password(service: &str, account: &str) -> Result<Option<String>> {
    let Some(access_group) = shared_access_group() else {
        return Ok(None);
    };
    let query = query(service, account, access_group, true);
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut result) };
    if status == ERR_SEC_ITEM_NOT_FOUND {
        return Ok(None);
    }
    if status != 0 {
        return Err(anyhow!("SecItemCopyMatching failed with OSStatus {status}"));
    }
    if result.is_null() {
        return Ok(None);
    }
    let data = unsafe { CFData::wrap_under_create_rule(result as CFDataRef) };
    Ok(Some(String::from_utf8(data.to_vec())?))
}

pub(crate) fn add_shared_password(service: &str, account: &str, password: &str) -> Result<()> {
    let Some(access_group) = shared_access_group() else {
        return Err(anyhow!("The process has no Spirit keychain access group"));
    };
    let mut options = ItemAddOptions::new(ItemAddValue::Data {
        class: ItemClass::generic_password(),
        data: CFData::from_buffer(password.as_bytes()),
    });
    options
        .set_service(service)
        .set_account_name(account)
        .set_access_group(access_group)
        .set_location(Location::DataProtectionKeychain);
    add_item(options.to_dictionary()).map_err(|error| anyhow!(error))
}

pub(crate) fn delete_shared_password(service: &str, account: &str) -> Result<()> {
    let Some(access_group) = shared_access_group() else {
        return Ok(());
    };
    let query = query(service, account, access_group, false);
    let status = unsafe { SecItemDelete(query.as_concrete_TypeRef()) };
    if status == ERR_SEC_ITEM_NOT_FOUND {
        return Ok(());
    }
    if status != 0 {
        return Err(anyhow!("SecItemDelete failed with OSStatus {status}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::select_spirit_access_group;

    #[test]
    fn selects_only_the_spirit_sharing_group() {
        let groups = vec![
            "TEAM.example.unrelated".to_string(),
            "TEAM.dev.spirit.shared".to_string(),
            "TEAM.dev.spirit.shared.other".to_string(),
        ];
        assert_eq!(
            select_spirit_access_group(&groups).as_deref(),
            Some("TEAM.dev.spirit.shared")
        );
        assert_eq!(
            select_spirit_access_group(&["TEAM.dev.spirit.shared.other".to_string()]),
            None
        );
    }
}
