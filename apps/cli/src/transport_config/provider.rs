use anyhow::{Result, anyhow};
use serde_json::{Map, Value, json};

use crate::model_provider_presets::cloudflare_ai_gateway_api_base_from_account_id;
use crate::model_registry::ModelProvider;

pub(crate) fn open_responses_sdk_provider(provider: Option<ModelProvider>) -> Option<&'static str> {
    match provider {
        Some(ModelProvider::Openai) | Some(ModelProvider::FireworksAi) => Some("openai"),
        Some(ModelProvider::Xai) => Some("xai"),
        Some(ModelProvider::Azure) => Some("azure"),
        Some(ModelProvider::VercelAiGateway)
        | Some(ModelProvider::CloudflareAiGateway)
        | Some(ModelProvider::Openrouter) => None,
        _ => Some("open-responses-compatible"),
    }
}

pub(crate) fn attach_google_vertex_transport_fields(
    transport: &mut Value,
    profile: &crate::model_registry::ModelProfile,
) -> Result<()> {
    if profile.provider != Some(ModelProvider::GoogleVertexAi) {
        return Ok(());
    }

    let obj = transport
        .as_object_mut()
        .ok_or_else(|| anyhow!("transport config is not a JSON object"))?;

    if let Some(project) = profile.vertex_project() {
        obj.insert("vertexProject".to_string(), json!(project));
    }
    if let Some(location) = profile.vertex_location() {
        obj.insert("vertexLocation".to_string(), json!(location));
    }

    if let Ok(client_email) =
        crate::model_registry::load_group_vertex_client_email_from_keyring(&profile.group_id)
    {
        let trimmed = client_email.trim();
        if !trimmed.is_empty() {
            obj.insert("vertexClientEmail".to_string(), json!(trimmed));
        }
    }
    if let Ok(private_key) =
        crate::model_registry::load_group_vertex_private_key_from_keyring(&profile.group_id)
    {
        let trimmed = private_key.trim();
        if !trimmed.is_empty() {
            obj.insert("vertexPrivateKey".to_string(), json!(trimmed));
        }
    }

    Ok(())
}

pub(crate) fn attach_cloudflare_ai_gateway_transport_fields(
    transport: &mut Value,
    profile: &crate::model_registry::ModelProfile,
) -> Result<()> {
    if profile.provider != Some(ModelProvider::CloudflareAiGateway) {
        return Ok(());
    }

    let account_id = profile.cloudflare_account_id().ok_or_else(|| {
        anyhow!(
            "Cloudflare AI Gateway model is missing cloudflareAccountId; import via the Desktop connect wizard or spirit model add"
        )
    })?;
    let gateway_id = profile.cloudflare_gateway_id().ok_or_else(|| {
        anyhow!(
            "Cloudflare AI Gateway model is missing cloudflareGatewayId; import via the Desktop connect wizard or spirit model add"
        )
    })?;

    let obj = transport
        .as_object_mut()
        .ok_or_else(|| anyhow!("transport config is not a JSON object"))?;
    obj.insert(
        "baseUrl".to_string(),
        json!(cloudflare_ai_gateway_api_base_from_account_id(&account_id)),
    );
    obj.insert("cloudflareGatewayId".to_string(), json!(gateway_id));
    obj.insert(
        "llmVendor".to_string(),
        json!(model_provider_vendor(ModelProvider::CloudflareAiGateway)),
    );
    Ok(())
}

pub(crate) fn model_provider_vendor(provider: ModelProvider) -> &'static str {
    match provider {
        ModelProvider::Deepseek => "deepseek",
        ModelProvider::Xai => "xai",
        ModelProvider::Moonshot => "moonshot-ai",
        ModelProvider::KimiCode => "kimi-code",
        ModelProvider::ZAi => "z-ai",
        ModelProvider::ZhipuAi => "zhipu-ai",
        ModelProvider::Minimax => "minimax",
        ModelProvider::Xiaomi => "xiaomi",
        ModelProvider::Siliconflow => "siliconflow",
        ModelProvider::Alibaba => "alibaba",
        ModelProvider::Anthropic => {
            unreachable!("Anthropic should not map to an openai-compatible llmVendor")
        }
        ModelProvider::VercelAiGateway => "vercel-ai-gateway",
        ModelProvider::CloudflareAiGateway => "cloudflare-ai-gateway",
        ModelProvider::Openrouter => "openrouter",
        ModelProvider::FireworksAi => "fireworks-ai",
        ModelProvider::TogetherAi => "together-ai",
        ModelProvider::Groq => "groq",
        ModelProvider::Deepinfra => "deepinfra",
        ModelProvider::HuggingFace => "hugging-face",
        ModelProvider::Baseten => "baseten",
        ModelProvider::Openai => "openai",
        ModelProvider::Google => "google",
        ModelProvider::GoogleVertexAi => "google-vertex-ai",
        ModelProvider::Volcengine => "volcengine",
        ModelProvider::Byteplus => "byteplus",
        ModelProvider::Azure => "azure",
        ModelProvider::AmazonBedrock => {
            unreachable!("Amazon Bedrock should not map to an openai-compatible llmVendor")
        }
        ModelProvider::Stepfun => "stepfun",
        ModelProvider::Meituan => "meituan",
        ModelProvider::TencentTokenhub => "tencent-tokenhub",
        ModelProvider::Mistral => "mistral",
        ModelProvider::Cohere => "cohere",
        ModelProvider::Custom => "custom",
    }
}

pub(crate) fn anthropic_effort_value(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim) {
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") => Some("high"),
        Some("xhigh") => Some("xhigh"),
        Some("max") => Some("max"),
        _ => None,
    }
}

pub(crate) fn model_capabilities_json(
    profile: &crate::model_registry::ModelProfile,
) -> Option<Value> {
    let capabilities = profile.explicit_capabilities()?;
    let mut object = Map::new();
    for capability in capabilities {
        match capability.as_str() {
            "languageModel" => {
                object.insert("languageModel".to_string(), Value::Bool(true));
            }
            "image" | "imageInput" => {
                object.insert("imageInput".to_string(), Value::Bool(true));
            }
            "audioInput" => {
                object.insert("audioInput".to_string(), Value::Bool(true));
            }
            "video" | "videoInput" => {
                object.insert("videoInput".to_string(), Value::Bool(true));
            }
            "imageGeneration" => {
                object.insert("imageGeneration".to_string(), Value::Bool(true));
            }
            "videoGeneration" => {
                object.insert("videoGeneration".to_string(), Value::Bool(true));
            }
            _ => {}
        }
    }
    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}
