use serde_json::{Map, Value};

use crate::model_registry::ModelProfile;

/// The Google Vertex SDK adapter package: its credential shape adds the `clientEmail` /
/// `privateKey` slots and the `project` / `location` options.
pub(crate) const GOOGLE_VERTEX_SDK_PACKAGE_NAME: &str = "@ai-sdk/google-vertex";

/// `"default"` / absent means "send no reasoning parameter"; declared values pass through
/// verbatim (mirrors host-internal `declaredReasoningEffort`).
pub(crate) fn declared_reasoning_effort(profile: &ModelProfile) -> Option<&str> {
    profile
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|effort| !effort.is_empty() && *effort != "default")
}

/// The Anthropic protocol's effort enum has no none/minimal/default; those send nothing.
pub(crate) fn anthropic_effort_value(value: Option<&str>) -> Option<&str> {
    let value = value?.trim();
    ["low", "medium", "high", "xhigh", "max"]
        .contains(&value)
        .then_some(value)
}

/// `supportedEfforts` for the anthropic transport: the declared list filtered to the
/// protocol's effort enum (mirrors host-internal `anthropicSupportedEfforts`).
pub(crate) fn anthropic_supported_efforts(profile: &ModelProfile) -> Option<Vec<String>> {
    profile.supported_reasoning_efforts.as_ref().map(|efforts| {
        efforts
            .iter()
            .filter(|effort| ["low", "medium", "high", "xhigh", "max"].contains(&effort.as_str()))
            .cloned()
            .collect()
    })
}

/// Maps declared capability tokens onto the daemon's `LlmModelCapabilities` shape
/// (mirrors host-internal `modelCapabilitiesFromConfig`).
pub(crate) fn model_capabilities_json(profile: &ModelProfile) -> Option<Value> {
    let capabilities = profile.capabilities.as_ref()?;
    let mut object = Map::new();
    for capability in capabilities {
        match capability.as_str() {
            "languageModel" => {
                object.insert("languageModel".to_string(), Value::Bool(true));
            }
            "image" => {
                object.insert("imageInput".to_string(), Value::Bool(true));
            }
            "audio" => {
                object.insert("audioInput".to_string(), Value::Bool(true));
            }
            "video" => {
                object.insert("videoInput".to_string(), Value::Bool(true));
            }
            "imageGeneration" => {
                object.insert("imageGeneration".to_string(), Value::Bool(true));
            }
            _ => {}
        }
    }
    Some(Value::Object(object))
}
