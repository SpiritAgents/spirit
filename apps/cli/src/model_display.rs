use std::collections::HashMap;

pub fn model_display_title<'a>(
    model_name: &'a str,
    display_titles: &'a HashMap<String, String>,
) -> &'a str {
    display_titles
        .get(model_name)
        .map(String::as_str)
        .unwrap_or(model_name)
}
