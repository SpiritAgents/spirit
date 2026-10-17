//! Bedrock Mantle helpers (aligned with `host-internal/resolve-transport`).

/// SigV4 signing region for `options.auth: "aws-sigv4"` (Bedrock Mantle): the wizard
/// materializes the region into the apiBase host, so the runtime parses it back off the URL
/// (`bedrock-mantle.<region>.api.aws`, mirroring `BEDROCK_MANTLE_HOST_PATTERN`).
pub fn bedrock_mantle_region_from_api_base(api_base: &str) -> Option<String> {
    let without_scheme = api_base
        .trim()
        .strip_prefix("https://")
        .or_else(|| api_base.trim().strip_prefix("http://"))?;
    let host = without_scheme
        .split('/')
        .next()?
        .split(':')
        .next()?
        .to_ascii_lowercase();
    let region = host
        .strip_prefix("bedrock-mantle.")?
        .strip_suffix(".api.aws")?;
    if region.is_empty()
        || !region
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return None;
    }
    Some(region.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bedrock_mantle_region_from_api_base_parses_the_host() {
        assert_eq!(
            bedrock_mantle_region_from_api_base(
                "https://bedrock-mantle.us-east-1.api.aws/openai/v1"
            ),
            Some("us-east-1".to_string())
        );
        assert_eq!(
            bedrock_mantle_region_from_api_base("https://bedrock-mantle.eu-west-2.api.aws"),
            Some("eu-west-2".to_string())
        );
        assert_eq!(
            bedrock_mantle_region_from_api_base("https://bedrock-mantle..api.aws"),
            None
        );
        assert_eq!(
            bedrock_mantle_region_from_api_base("https://api.openai.com/v1"),
            None
        );
        assert_eq!(bedrock_mantle_region_from_api_base("not a url"), None);
    }
}
