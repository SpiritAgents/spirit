use anyhow::{Result, anyhow};

use crate::model_registry::{
    ModelProfile, ModelTransportKind, declares_key_channel, env_channel_value,
    resolve_provider_api_key, resolve_provider_credential_slot,
};
use crate::transport_config::constants::ENV_API_KEY;

use super::{TransportHost, provider::GOOGLE_VERTEX_SDK_PACKAGE_NAME};

fn read_keyring_via_store(
    host: &TransportHost<'_>,
    service: &str,
    account: &str,
) -> Option<String> {
    host.secret_store
        .read_keyring_secret(service, account)
        .ok()
        .flatten()
}

pub(crate) fn resolve_credential_slot_from_store(
    host: &TransportHost<'_>,
    profile: &ModelProfile,
    slot: &str,
) -> Option<String> {
    resolve_provider_credential_slot(&profile.key_channels(), slot, env_channel_value, |s, a| {
        read_keyring_via_store(host, s, a)
    })
}

/// Resolves the effective Bearer key for a profile. Mirrors host-internal
/// `tryResolveTransportConfig`: IAM-capable mechanisms (bedrock transport, `options.auth:
/// "aws-sigv4"`) authenticate without a Bearer key — the builder validates their slots; an
/// entry declaring no key channel at all is an unauthenticated endpoint (empty key); a
/// declared channel resolving to nothing is a setup error.
pub(crate) fn resolve_key_from_store(
    host: &TransportHost<'_>,
    profile: &ModelProfile,
) -> Result<String> {
    let channels = profile.key_channels();
    let resolved = resolve_provider_api_key(&channels, env_channel_value, |service, account| {
        read_keyring_via_store(host, service, account)
    });
    if let Some(key) = resolved {
        return Ok(key);
    }

    if profile.resolved_sdk_package_name().as_deref() == Some(GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
        let client_email = resolve_credential_slot_from_store(host, profile, "clientEmail");
        let private_key = resolve_credential_slot_from_store(host, profile, "privateKey");
        if client_email.is_none() || private_key.is_none() {
            return Err(anyhow!(
                "No Vertex credentials found for model \"{}\". Run setup again.",
                profile.name
            ));
        }
        return Ok(String::new());
    }

    let sigv4 = profile.transport_kind() == ModelTransportKind::OpenResponses
        && profile.options_auth_aws_sigv4();
    if profile.transport_kind() == ModelTransportKind::Bedrock || sigv4 {
        return Ok(String::new());
    }

    if declares_key_channel(&channels) {
        return Err(anyhow!(
            "No API key found for model \"{}\". Run setup again.",
            profile.name
        ));
    }

    Ok(String::new())
}

/// Optional key resolution for the image/video generation blocks: the `SPIRIT_API_KEY`
/// process override wins, then the provider's credential channels; unresolved = skip the
/// block rather than failing the config change.
pub(crate) fn resolve_optional_key_from_store(
    host: &TransportHost<'_>,
    profile: &ModelProfile,
) -> Result<Option<String>> {
    if let Some(value) = env_channel_value(ENV_API_KEY) {
        return Ok(Some(value));
    }
    Ok(resolve_provider_api_key(
        &profile.key_channels(),
        env_channel_value,
        |service, account| read_keyring_via_store(host, service, account),
    ))
}
