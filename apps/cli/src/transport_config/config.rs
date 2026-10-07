use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{env, path::Path};

use crate::{
    model_provider_presets::{
        azure_api_base_from_resource_name, resolve_azure_resource_name, resolve_profile_api_base,
    },
    model_registry::{
        AppConfig, ModelProvider, load_group_access_key_id_from_keyring,
        load_group_secret_access_key_from_keyring, normalize_reasoning_effort_value,
        normalize_reasoning_mode_value,
    },
    transport_config::constants::{ENV_API_BASE, ENV_API_KEY},
};

use super::{
    TransportHost,
    keys::resolve_optional_key_from_store,
    provider::{
        anthropic_effort_value, attach_cloudflare_ai_gateway_transport_fields,
        attach_google_vertex_transport_fields, model_capabilities_json, model_provider_vendor,
        open_responses_sdk_provider,
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

fn profile_transport_signature(
    profile: &crate::model_registry::ModelProfile,
) -> (
    String,
    Option<ModelProvider>,
    crate::model_registry::ModelTransportKind,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        profile.api_base.clone(),
        profile.provider,
        profile.transport_kind(),
        profile.reasoning_effort.clone(),
        profile.reasoning_mode.clone(),
        profile.service_tier.clone(),
        profile.upstream_provider.clone(),
    )
}

pub(crate) fn transport_config_will_change(stored_config: &AppConfig, config: &AppConfig) -> bool {
    if stored_config.active_model != config.active_model {
        return true;
    }

    if stored_config
        .active_model_profile()
        .as_ref()
        .map(profile_transport_signature)
        != config
            .active_model_profile()
            .as_ref()
            .map(profile_transport_signature)
    {
        return true;
    }

    if stored_config.image_generation_model != config.image_generation_model {
        return true;
    }

    if stored_config
        .image_generation_model_profile()
        .as_ref()
        .map(|profile| {
            (
                profile.api_base.clone(),
                profile.provider,
                profile.transport_kind(),
                profile.supports_image_generation(),
            )
        })
        != config
            .image_generation_model_profile()
            .as_ref()
            .map(|profile| {
                (
                    profile.api_base.clone(),
                    profile.provider,
                    profile.transport_kind(),
                    profile.supports_image_generation(),
                )
            })
    {
        return true;
    }

    if stored_config.video_generation_model != config.video_generation_model {
        return true;
    }

    stored_config
        .video_generation_model_profile()
        .as_ref()
        .map(|profile| {
            (
                profile.api_base.clone(),
                profile.provider,
                profile.transport_kind(),
                profile.supports_video_generation(),
            )
        })
        != config
            .video_generation_model_profile()
            .as_ref()
            .map(|profile| {
                (
                    profile.api_base.clone(),
                    profile.provider,
                    profile.transport_kind(),
                    profile.supports_video_generation(),
                )
            })
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
    let Some(image_api_key) = resolve_optional_key_from_store(
        host,
        &image_profile.group_id,
        &image_profile.name,
        image_profile.provider,
    )?
    else {
        return Ok(());
    };

    let mut image_generation = serde_json::json!({
        "apiKey": image_api_key,
        "model": image_profile.name,
        "baseUrl": resolve_profile_api_base(&image_profile),
    });
    if let Some(provider) = image_profile.provider
        && let Some(obj) = image_generation.as_object_mut()
    {
        obj.insert(
            "llmVendor".to_string(),
            json!(model_provider_vendor(provider)),
        );
    }
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
    let Some(video_api_key) = resolve_optional_key_from_store(
        host,
        &video_profile.group_id,
        &video_profile.name,
        video_profile.provider,
    )?
    else {
        return Ok(());
    };

    let mut video_generation = serde_json::json!({
        "apiKey": video_api_key,
        "model": video_profile.name,
        "baseUrl": resolve_profile_api_base(&video_profile),
    });
    if let Some(provider) = video_profile.provider
        && let Some(obj) = video_generation.as_object_mut()
    {
        obj.insert(
            "llmVendor".to_string(),
            json!(model_provider_vendor(provider)),
        );
    }
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
            super::keys::resolve_key_from_store(
                host,
                &active.group_id,
                &active.name,
                active.provider,
            )?
        } else {
            trimmed.to_string()
        }
    } else {
        super::keys::resolve_key_from_store(host, &active.group_id, &active.name, active.provider)?
    };

    let api_base = env::var(ENV_API_BASE).unwrap_or_else(|_| resolve_profile_api_base(&active));

    let normalized_reasoning_effort = normalize_reasoning_effort_value(
        active.reasoning_effort.clone(),
        active.provider,
        active.transport_kind(),
        &active.name,
    );
    let normalized_reasoning_mode = normalize_reasoning_mode_value(
        active.reasoning_mode.clone(),
        active.provider,
        &active.name,
    );

    let mut transport = if active.transport_kind()
        == crate::model_registry::ModelTransportKind::Anthropic
    {
        serde_json::json!({
            "transportKind": "anthropic",
            "apiKey": api_key,
            "model": active.name,
            "baseUrl": api_base,
            "workspaceRoot": host.workspace_root,
        })
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::OpenResponses {
        let mut transport = serde_json::json!({
            "transportKind": "open-responses",
            "apiKey": api_key,
            "model": active.name,
            "baseUrl": api_base,
            "workspaceRoot": host.workspace_root,
        });
        if let Some(responses_provider) = open_responses_sdk_provider(active.provider)
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("responsesProvider".to_string(), json!(responses_provider));
        }
        if active.provider == Some(ModelProvider::Azure) {
            let resource_name = resolve_azure_resource_name(
                    active.azure_resource_name(),
                    &api_base,
                )
                .ok_or_else(|| {
                    anyhow!("Azure model is missing azureResourceName; import via the Desktop connect wizard or spirit model add --azure-resource-name")
                })?;
            let azure_base = azure_api_base_from_resource_name(&resource_name);
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("baseUrl".to_string(), json!(azure_base));
                obj.insert("azureResourceName".to_string(), json!(resource_name));
                obj.insert("llmVendor".to_string(), json!("azure"));
            }
        }
        transport
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::Bedrock {
        if active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name)
        {
            let region = active.aws_region().ok_or_else(|| {
                    anyhow!("Amazon Bedrock model is missing awsRegion; import via the Desktop connect wizard or write config.json manually")
                })?;
            let mantle_base = crate::bedrock_mantle::bedrock_mantle_api_base_from_region(&region);
            let mut transport = serde_json::json!({
                "transportKind": "open-responses",
                "model": active.name,
                "baseUrl": mantle_base,
                "workspaceRoot": host.workspace_root,
                "responsesProvider": "openai",
                "llmVendor": "openai",
            });
            if !api_key.trim().is_empty() {
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert("apiKey".to_string(), json!(api_key));
                }
            } else if let Ok(access_key_id) =
                load_group_access_key_id_from_keyring(&active.group_id)
                && let Ok(secret_access_key) =
                    load_group_secret_access_key_from_keyring(&active.group_id)
            {
                let access_key_id = access_key_id.trim();
                let secret_access_key = secret_access_key.trim();
                if !access_key_id.is_empty()
                    && !secret_access_key.is_empty()
                    && let Some(obj) = transport.as_object_mut()
                {
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
            transport
        } else {
            let region = active.aws_region().ok_or_else(|| {
                anyhow!("Amazon Bedrock model is missing awsRegion; import via the Desktop connect wizard or write config.json manually")
            })?;
            let mut transport = serde_json::json!({
                "transportKind": "bedrock",
                "model": active.name,
                "region": region,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            });
            if !api_key.trim().is_empty()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("apiKey".to_string(), json!(api_key));
            }
            if let Ok(access_key_id) = load_group_access_key_id_from_keyring(&active.group_id)
                && let Ok(secret_access_key) =
                    load_group_secret_access_key_from_keyring(&active.group_id)
            {
                let access_key_id = access_key_id.trim();
                let secret_access_key = secret_access_key.trim();
                if !access_key_id.is_empty()
                    && !secret_access_key.is_empty()
                    && let Some(obj) = transport.as_object_mut()
                {
                    obj.insert("accessKeyId".to_string(), json!(access_key_id));
                    obj.insert("secretAccessKey".to_string(), json!(secret_access_key));
                }
            }
            transport
        }
    } else {
        serde_json::json!({
            "apiKey": api_key,
            "model": active.name,
            "baseUrl": api_base,
            "workspaceRoot": host.workspace_root,
        })
    };

    if let Some(model_capabilities) = model_capabilities_json(&active)
        && let Some(obj) = transport.as_object_mut()
    {
        obj.insert("modelCapabilities".to_string(), model_capabilities);
    }

    if active.transport_kind() == crate::model_registry::ModelTransportKind::Anthropic {
        if let Some(effort) = anthropic_effort_value(normalized_reasoning_effort.as_deref())
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("effort".to_string(), json!(effort));
        }
        // Mirrors the TS buildTransportFromProfile anthropic branch: serviceTier only,
        // never upstreamProvider.
        if let Some(service_tier) = active.service_tier.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("serviceTier".to_string(), json!(service_tier));
        }
        if let Some(provider) = active.provider
            && provider != ModelProvider::Anthropic
            && provider != ModelProvider::AmazonBedrock
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert(
                "llmVendor".to_string(),
                json!(model_provider_vendor(provider)),
            );
        }
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::OpenResponses
        || (active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name))
    {
        let is_mantle_openai = active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name);
        if !is_mantle_openai
            && let Some(provider) = active.provider
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert(
                "llmVendor".to_string(),
                json!(model_provider_vendor(provider)),
            );
        }
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
        }
        if let Some(reasoning_mode) = normalized_reasoning_mode.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("reasoningMode".to_string(), json!(reasoning_mode));
        }
        // The TS mantle branch returns its own open-responses shape without tier fields,
        // so only the plain open-responses path stamps them.
        if !is_mantle_openai {
            if let Some(service_tier) = active.service_tier.as_deref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("serviceTier".to_string(), json!(service_tier));
            }
            if let Some(upstream_provider) = active.upstream_provider.as_deref()
                && let Some(obj) = transport.as_object_mut()
            {
                obj.insert("upstreamProvider".to_string(), json!(upstream_provider));
            }
        }
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::Bedrock
        && !(active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name))
    {
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
        }
    } else {
        if let Some(provider) = active.provider
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert(
                "llmVendor".to_string(),
                json!(model_provider_vendor(provider)),
            );
        }
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
        }
        if let Some(reasoning_mode) = normalized_reasoning_mode.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("reasoningMode".to_string(), json!(reasoning_mode));
        }
        if let Some(service_tier) = active.service_tier.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("serviceTier".to_string(), json!(service_tier));
        }
        if let Some(upstream_provider) = active.upstream_provider.as_deref()
            && let Some(obj) = transport.as_object_mut()
        {
            obj.insert("upstreamProvider".to_string(), json!(upstream_provider));
        }
    }
    attach_image_generation_config(host, &mut transport, config)?;
    attach_google_vertex_transport_fields(&mut transport, &active)?;
    attach_cloudflare_ai_gateway_transport_fields(&mut transport, &active)?;
    attach_video_generation_config(host, &mut transport, config)?;
    Ok(transport)
}
