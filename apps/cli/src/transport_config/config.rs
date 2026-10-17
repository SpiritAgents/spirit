use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{env, path::Path};

use crate::{
    model_registry::{AppConfig, ModelProfile, ModelTransportKind},
    transport_config::constants::{ENV_API_BASE, ENV_API_KEY},
};

use super::{
    TransportHost,
    keys::{resolve_credential_slot_from_store, resolve_optional_key_from_store},
    provider::{
        GOOGLE_VERTEX_SDK_PACKAGE_NAME, anthropic_effort_value, anthropic_supported_efforts,
        declared_reasoning_effort, model_capabilities_json,
    },
};

pub(crate) fn build_mcp_only_transport_config(workspace_root: &Path) -> Value {
    json!({
        "apiKey": "mcp-only",
        "model": "mcp-only",
        "baseUrl": "https://example.invalid/v1",
        "workspaceRoot": workspace_root,
    })
}

fn profile_signature(profile: &ModelProfile) -> Value {
    serde_json::to_value(profile).unwrap_or(Value::Null)
}

pub(crate) fn transport_config_will_change(stored_config: &AppConfig, config: &AppConfig) -> bool {
    if stored_config.active_model != config.active_model {
        return true;
    }

    if stored_config
        .active_model_profile()
        .as_ref()
        .map(profile_signature)
        != config
            .active_model_profile()
            .as_ref()
            .map(profile_signature)
    {
        return true;
    }

    if stored_config.image_generation_model != config.image_generation_model {
        return true;
    }

    if stored_config
        .image_generation_model_profile()
        .as_ref()
        .map(profile_signature)
        != config
            .image_generation_model_profile()
            .as_ref()
            .map(profile_signature)
    {
        return true;
    }

    if stored_config.video_generation_model != config.video_generation_model {
        return true;
    }

    stored_config
        .video_generation_model_profile()
        .as_ref()
        .map(profile_signature)
        != config
            .video_generation_model_profile()
            .as_ref()
            .map(profile_signature)
}

pub(crate) fn attach_image_generation_config(
    host: &TransportHost<'_>,
    transport: &mut Value,
    config: &AppConfig,
) -> Result<()> {
    let Some(image_profile) = config.image_generation_model_profile() else {
        return Ok(());
    };
    if !image_profile.supports_image_generation() {
        return Ok(());
    }
    let Some(image_api_key) = resolve_optional_key_from_store(host, &image_profile)? else {
        return Ok(());
    };

    let mut image_generation = serde_json::json!({
        "apiKey": image_api_key,
        "model": image_profile.name,
        "baseUrl": image_profile.api_base,
    });
    if let Some(model_capabilities) = model_capabilities_json(&image_profile)
        && let Some(obj) = image_generation.as_object_mut()
    {
        obj.insert("modelCapabilities".to_string(), model_capabilities);
    }
    if let Some(obj) = transport.as_object_mut() {
        obj.insert("imageGeneration".to_string(), image_generation);
    }
    Ok(())
}

pub(crate) fn attach_video_generation_config(
    host: &TransportHost<'_>,
    transport: &mut Value,
    config: &AppConfig,
) -> Result<()> {
    let Some(video_profile) = config.video_generation_model_profile() else {
        return Ok(());
    };
    if !video_profile.supports_video_generation() {
        return Ok(());
    }
    let Some(video_api_key) = resolve_optional_key_from_store(host, &video_profile)? else {
        return Ok(());
    };

    let mut video_generation = serde_json::json!({
        "apiKey": video_api_key,
        "model": video_profile.name,
        "baseUrl": video_profile.api_base,
    });
    if let Some(model_capabilities) = model_capabilities_json(&video_profile)
        && let Some(obj) = video_generation.as_object_mut()
    {
        obj.insert("modelCapabilities".to_string(), model_capabilities);
    }
    if let Some(obj) = transport.as_object_mut() {
        obj.insert("videoGeneration".to_string(), video_generation);
    }
    Ok(())
}

/// Builds the daemon transport JSON from a resolved v1 profile. Mirrors host-internal
/// `buildTransportFromProfile` (the CLI uses it to pre-validate a config change; the daemon
/// re-resolves the transport from config.json itself on `session.replaceConfig`).
fn build_transport_from_profile(
    host: &TransportHost<'_>,
    profile: &ModelProfile,
    api_key: &str,
    api_base: &str,
) -> Result<Value> {
    let transport_kind = profile.transport_kind();
    let reasoning_effort = declared_reasoning_effort(profile);

    let mut transport = match transport_kind {
        ModelTransportKind::Bedrock => {
            let region = profile.option_str("awsRegion").ok_or_else(|| {
                anyhow!("Amazon Bedrock model is missing AWS region configuration.")
            })?;
            let mut transport = json!({
                "transportKind": "bedrock",
                "model": profile.name,
                "region": region,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            });
            if !api_key.trim().is_empty()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("apiKey".to_string(), json!(api_key));
            }
            let access_key_id = resolve_credential_slot_from_store(host, profile, "accessKeyId");
            let secret_access_key =
                resolve_credential_slot_from_store(host, profile, "secretAccessKey");
            if let (Some(access_key_id), Some(secret_access_key)) =
                (access_key_id, secret_access_key)
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("accessKeyId".to_string(), json!(access_key_id));
                obj.insert("secretAccessKey".to_string(), json!(secret_access_key));
            }
            if let Some(effort) = reasoning_effort
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("reasoningEffort".to_string(), json!(effort));
            }
            if let Some(efforts) = profile.supported_reasoning_efforts.as_ref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("supportedReasoningEfforts".to_string(), json!(efforts));
            }
            transport
        }
        ModelTransportKind::OpenResponses => {
            let mut transport = json!({
                "transportKind": "open-responses",
                "apiKey": api_key,
                "model": profile.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
                "agentMode": "agent",
            });
            if profile.options_auth_aws_sigv4() && api_key.trim().is_empty() {
                let access_key_id =
                    resolve_credential_slot_from_store(host, profile, "accessKeyId");
                let secret_access_key =
                    resolve_credential_slot_from_store(host, profile, "secretAccessKey");
                let (Some(access_key_id), Some(secret_access_key)) =
                    (access_key_id, secret_access_key)
                else {
                    return Err(anyhow!(
                        "Amazon Bedrock Mantle requires a Bearer API key or IAM credentials."
                    ));
                };
                let region = crate::bedrock_mantle::bedrock_mantle_region_from_api_base(api_base)
                    .ok_or_else(|| {
                        anyhow!(
                            "Amazon Bedrock Mantle apiBase does not carry an AWS region (expected a bedrock-mantle.<region>.api.aws host)."
                        )
                    })?;
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert(
                        "bedrockMantleIam".to_string(),
                        json!({
                            "region": region,
                            "accessKeyId": access_key_id,
                            "secretAccessKey": secret_access_key,
                        }),
                    );
                }
            }
            if let Some(service_tier) = profile.service_tier.as_deref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("serviceTier".to_string(), json!(service_tier));
            }
            if let Some(effort) = reasoning_effort
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("reasoningEffort".to_string(), json!(effort));
            }
            transport
        }
        ModelTransportKind::Anthropic => {
            let mut transport = json!({
                "transportKind": "anthropic",
                "apiKey": api_key,
                "model": profile.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            });
            if let Some(service_tier) = profile.service_tier.as_deref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("serviceTier".to_string(), json!(service_tier));
            }
            if let Some(supported_efforts) = anthropic_supported_efforts(profile)
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("supportedEfforts".to_string(), json!(supported_efforts));
            }
            if let Some(effort) = anthropic_effort_value(reasoning_effort)
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("effort".to_string(), json!(effort));
            }
            if let Some(supports_thinking_switch) = profile.supports_thinking_switch
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert(
                    "supportsThinkingSwitch".to_string(),
                    json!(supports_thinking_switch),
                );
            }
            if profile.thinking_enabled == Some(false)
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("vendorExtendedThinking".to_string(), json!(false));
            }
            transport
        }
        ModelTransportKind::OpenAiCompatible => {
            let mut transport = json!({
                "transportKind": "openai-compatible",
                "apiKey": api_key,
                "model": profile.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            });
            if profile.resolved_sdk_package_name().as_deref()
                == Some(GOOGLE_VERTEX_SDK_PACKAGE_NAME)
                && let Some(obj) = transport.as_object_mut()
            {
                if let Some(project) = profile.option_str("project") {
                    obj.insert("vertexProject".to_string(), json!(project));
                }
                if let Some(location) = profile.option_str("location") {
                    obj.insert("vertexLocation".to_string(), json!(location));
                }
                if let Some(client_email) =
                    resolve_credential_slot_from_store(host, profile, "clientEmail")
                {
                    obj.insert("vertexClientEmail".to_string(), json!(client_email));
                }
                if let Some(private_key) =
                    resolve_credential_slot_from_store(host, profile, "privateKey")
                {
                    obj.insert("vertexPrivateKey".to_string(), json!(private_key));
                }
            }
            if let Some(service_tier) = profile.service_tier.as_deref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("serviceTier".to_string(), json!(service_tier));
            }
            if let Some(effort) = reasoning_effort
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("reasoningEffort".to_string(), json!(effort));
            }
            if let Some(supports_thinking_switch) = profile.supports_thinking_switch
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert(
                    "supportsThinkingSwitch".to_string(),
                    json!(supports_thinking_switch),
                );
            }
            if profile.thinking_enabled == Some(false)
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("vendorExtendedThinking".to_string(), json!(false));
            }
            transport
        }
    };

    if let Some(model_capabilities) = model_capabilities_json(profile)
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("modelCapabilities".to_string(), model_capabilities);
    }

    // Declaration fields carried verbatim onto the transport config. bedrock is a self-held
    // implementation; there is no SDK adapter to declare.
    if transport_kind != ModelTransportKind::Bedrock
        && let Some(sdk) = profile.sdk.as_deref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("sdk".to_string(), json!(sdk));
    }
    if let Some(headers) = profile.headers.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("headers".to_string(), json!(headers));
    }
    if let Some(body) = profile.body.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("body".to_string(), json!(body));
    }
    if let Some(provider_tools) = profile.provider_tools.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("providerTools".to_string(), json!(provider_tools));
    }
    if let Some(file_upload) = profile.file_upload.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("fileUpload".to_string(), file_upload.clone());
    }
    if let Some(options) = profile.options.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("options".to_string(), json!(options));
    }
    if let Some(output_limit) = profile.output_limit
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("outputLimit".to_string(), json!(output_limit));
    }
    if let Some(reasoning_mode) = profile.reasoning_mode.as_deref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("reasoningMode".to_string(), json!(reasoning_mode));
    }
    if let Some(supported_reasoning_modes) = profile.supported_reasoning_modes.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert(
            "supportedReasoningModes".to_string(),
            json!(supported_reasoning_modes),
        );
    }
    if let Some(thinking_switch) = profile.thinking_switch.as_ref()
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("thinkingSwitch".to_string(), thinking_switch.clone());
    }

    Ok(transport)
}

pub(crate) fn resolve_transport_config_json_for(
    host: &TransportHost<'_>,
    config: &AppConfig,
) -> Result<Value> {
    let Some(active) = config
        .active_model_profile()
        .filter(|profile| !profile.name.trim().is_empty())
    else {
        return Ok(build_mcp_only_transport_config(host.workspace_root));
    };

    let api_key = if let Ok(value) = env::var(ENV_API_KEY) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            super::keys::resolve_key_from_store(host, &active)?
        } else {
            trimmed.to_string()
        }
    } else {
        super::keys::resolve_key_from_store(host, &active)?
    };

    let api_base = env::var(ENV_API_BASE).unwrap_or_else(|_| active.api_base.clone());

    let mut transport = build_transport_from_profile(host, &active, &api_key, &api_base)?;
    attach_image_generation_config(host, &mut transport, config)?;
    attach_video_generation_config(host, &mut transport, config)?;
    Ok(transport)
}
