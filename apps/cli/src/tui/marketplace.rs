use super::*;

/// Reserved id of the UI-level "All" pseudo source: a merged, display-only
/// catalog over every added source, resolved by the daemon's catalog RPC.
const ALL_MARKETPLACE_SOURCE_ID: &str = "all";

/// The All pseudo source pinned first in the source bar; kind/locator are
/// placeholders — the TUI only reads the id, and the daemon resolves it.
fn all_marketplace_source() -> CliMarketplaceSource {
    CliMarketplaceSource {
        id: ALL_MARKETPLACE_SOURCE_ID.into(),
        name: ALL_MARKETPLACE_SOURCE_ID.into(),
        display_name: ALL_MARKETPLACE_SOURCE_ID.into(),
        kind: ALL_MARKETPLACE_SOURCE_ID.into(),
        locator: String::new(),
        git_ref: None,
        added_at_unix_ms: 0,
        internal: true,
    }
}

/// Visible source tabs: internal-source tabs hide while their catalog is empty
/// for this host; user-added sources always keep their tab (the user added
/// them explicitly).
fn visible_marketplace_sources(
    sources: Vec<CliMarketplaceSource>,
    built_in_empty: bool,
    personal_empty: bool,
) -> Vec<CliMarketplaceSource> {
    sources
        .into_iter()
        .filter(|source| match source.id.as_str() {
            "built-in" => !built_in_empty,
            "personal" => !personal_empty,
            _ => true,
        })
        .collect()
}

/// Two-level marketplace flow (list → detail) over the multi-source backend.
/// The source bar switches sources with Left/Right while the list keeps focus;
/// entries pin exact versions, so there is no version picker and no README.
#[derive(Debug, Default)]
pub(crate) struct MarketplaceState {
    pub(crate) sources: Vec<CliMarketplaceSource>,
    pub(crate) active_source_index: usize,
    pub(crate) catalog: Vec<CliMarketplaceCatalogEntry>,
    pub(crate) open: bool,
    pub(crate) step_stack: Vec<MarketplaceFlowStep>,
    pub(crate) catalog_filter: String,
    pub(crate) catalog_selected_index: usize,
    pub(crate) detail_action_selected_index: usize,
    pub(crate) confirm_selected_index: usize,
    /// Composite id (`<sourceId>/<name>`) of the extension open in detail.
    pub(crate) current_extension_id: Option<String>,
    pub(crate) error: Option<String>,
    /// Guards against double-submitting an install/update while the RPC is in flight.
    pub(crate) install_guard: Option<String>,
}

impl MarketplaceState {
    pub(crate) fn close(&mut self) {
        self.open = false;
        self.step_stack.clear();
        self.current_extension_id = None;
        self.install_guard = None;
        self.error = None;
    }
}

impl TuiShell {
    pub fn refresh_marketplace_catalog(&mut self) -> Result<()> {
        let all_sources = self
            .runtime
            .list_marketplace_sources()
            .context(t!("tui.marketplace.catalog_read_failed").into_owned())?;
        // The merged catalog doubles as the tab-visibility signal: internal
        // sources hide while they contribute no entries for this host.
        let merged = self
            .runtime
            .list_marketplace_catalog(ALL_MARKETPLACE_SOURCE_ID)
            .context(t!("tui.marketplace.catalog_read_failed").into_owned())?;
        let has_entries =
            |source_id: &str| merged.items.iter().any(|item| item.source_id == source_id);
        let mut visible = visible_marketplace_sources(
            all_sources,
            !has_entries("built-in"),
            !has_entries("personal"),
        );
        // The All pseudo source is pinned first and shows exactly when any tab
        // shows — an all-empty marketplace hides the whole source bar.
        if !visible.is_empty() {
            visible.insert(0, all_marketplace_source());
        }
        self.marketplace.sources = visible;
        if self.marketplace.sources.is_empty() {
            self.marketplace.catalog = Vec::new();
        } else {
            if self.marketplace.active_source_index >= self.marketplace.sources.len() {
                self.marketplace.active_source_index = 0;
            }
            let active_is_all = self
                .marketplace
                .sources
                .get(self.marketplace.active_source_index)
                .is_some_and(|source| source.id == ALL_MARKETPLACE_SOURCE_ID);
            if active_is_all {
                // The All view reuses the merged catalog fetched for visibility.
                if let Some(warning) = merged.warning.as_deref() {
                    self.push_marketplace_warning(warning);
                }
                self.marketplace.catalog = merged.items;
            } else {
                self.marketplace.catalog = self.load_active_source_catalog()?;
            }
        }
        logging::log_event(&format!(
            "[marketplace] refreshed sources={} items={}",
            self.marketplace.sources.len(),
            self.marketplace.catalog.len()
        ));
        self.marketplace.error = None;
        self.marketplace_sync_current_step_selection();
        Ok(())
    }

    fn load_active_source_catalog(&mut self) -> Result<Vec<CliMarketplaceCatalogEntry>> {
        let Some(source) = self
            .marketplace
            .sources
            .get(self.marketplace.active_source_index)
        else {
            return Ok(Vec::new());
        };
        let response = self
            .runtime
            .list_marketplace_catalog(&source.id)
            .with_context(|| {
                t!(
                    "tui.marketplace.catalog_read_failed_source",
                    name = source.display_name.clone()
                )
                .into_owned()
            })?;
        if let Some(warning) = response.warning.as_deref() {
            self.push_marketplace_warning(warning);
        }
        Ok(response.items)
    }

    fn push_marketplace_warning(&mut self, warning: &str) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: warning.to_string(),
            tool_block: None,
        });
    }

    /// Left/Right switches the source directly; the list keeps focus.
    pub fn marketplace_switch_source(&mut self, delta: isize) {
        let len = self.marketplace.sources.len();
        if len == 0 {
            return;
        }
        let current = self.marketplace.active_source_index as isize;
        self.marketplace.active_source_index = (current + delta).rem_euclid(len as isize) as usize;
        self.marketplace.catalog_selected_index = 0;
        self.marketplace.current_extension_id = None;
        match self.load_active_source_catalog() {
            Ok(items) => {
                self.marketplace.catalog = items;
                self.marketplace.error = None;
            }
            Err(err) => {
                self.marketplace.catalog = Vec::new();
                self.marketplace.error = Some(err.to_string());
            }
        }
        self.marketplace_sync_current_step_selection();
    }

    pub fn marketplace_selected_catalog_item(&self) -> Option<&CliMarketplaceCatalogEntry> {
        let index = self
            .marketplace_filtered_catalog_indices()
            .get(self.marketplace.catalog_selected_index)
            .copied()?;
        self.marketplace.catalog.get(index)
    }

    pub fn marketplace_current_step(&self) -> Option<MarketplaceFlowStep> {
        self.marketplace.step_stack.last().copied()
    }

    pub fn marketplace_filter_accepts_input(&self) -> bool {
        matches!(
            self.marketplace_current_step(),
            Some(MarketplaceFlowStep::CatalogPicker)
        )
    }

    pub fn marketplace_move_selection_next(&mut self) {
        let len = self.marketplace_current_items_len();
        if len == 0 {
            return;
        }
        let selected = self.marketplace_selected_index_mut();
        *selected = (*selected + 1) % len;
        self.marketplace.install_guard = None;
    }

    pub fn marketplace_move_selection_prev(&mut self) {
        let len = self.marketplace_current_items_len();
        if len == 0 {
            return;
        }
        let selected = self.marketplace_selected_index_mut();
        *selected = if *selected == 0 {
            len - 1
        } else {
            *selected - 1
        };
        self.marketplace.install_guard = None;
    }

    pub fn marketplace_clear_filter(&mut self) {
        self.marketplace.catalog_filter.clear();
        self.marketplace_sync_current_step_selection();
    }

    pub fn marketplace_insert_filter_char(&mut self, ch: char) {
        if ch == '\n' || ch == '\r' {
            return;
        }
        self.marketplace.catalog_filter.push(ch);
        self.marketplace_sync_current_step_selection();
    }

    pub fn marketplace_insert_filter_text(&mut self, text: &str) {
        let filtered = text.chars().filter(|ch| *ch != '\n' && *ch != '\r');
        self.marketplace.catalog_filter.extend(filtered);
        self.marketplace_sync_current_step_selection();
    }

    pub fn marketplace_backspace_filter(&mut self) {
        self.marketplace.catalog_filter.pop();
        self.marketplace_sync_current_step_selection();
    }

    pub fn marketplace_submit_selection(&mut self) {
        match self.marketplace_current_step() {
            Some(MarketplaceFlowStep::CatalogPicker) => self.marketplace_open_selected_detail(),
            Some(MarketplaceFlowStep::DetailActions) => self.marketplace_run_selected_action(),
            Some(MarketplaceFlowStep::UnverifiedConfirm) => {
                self.marketplace_handle_install_confirmation()
            }
            None => {}
        }
    }

    pub fn marketplace_go_back(&mut self) {
        match self.marketplace_current_step() {
            Some(MarketplaceFlowStep::CatalogPicker) | None => self.close_marketplace_view(),
            Some(MarketplaceFlowStep::DetailActions | MarketplaceFlowStep::UnverifiedConfirm) => {
                self.marketplace.step_stack.pop();
            }
        }
        self.marketplace.error = None;
        self.marketplace_sync_current_step_selection();
    }

    fn marketplace_current_items_len(&self) -> usize {
        match self.marketplace_current_step() {
            Some(MarketplaceFlowStep::CatalogPicker) => {
                self.marketplace_filtered_catalog_indices().len()
            }
            Some(MarketplaceFlowStep::DetailActions) => {
                self.marketplace_detail_action_items().len()
            }
            Some(MarketplaceFlowStep::UnverifiedConfirm) => {
                self.marketplace_confirmation_items().len()
            }
            None => 0,
        }
    }

    fn marketplace_selected_index_mut(&mut self) -> &mut usize {
        match self
            .marketplace_current_step()
            .unwrap_or(MarketplaceFlowStep::CatalogPicker)
        {
            MarketplaceFlowStep::CatalogPicker => &mut self.marketplace.catalog_selected_index,
            MarketplaceFlowStep::DetailActions => {
                &mut self.marketplace.detail_action_selected_index
            }
            MarketplaceFlowStep::UnverifiedConfirm => &mut self.marketplace.confirm_selected_index,
        }
    }

    fn marketplace_sync_current_step_selection(&mut self) {
        match self.marketplace_current_step() {
            Some(MarketplaceFlowStep::CatalogPicker) => {
                let len = self.marketplace_filtered_catalog_indices().len();
                if len == 0 {
                    self.marketplace.catalog_selected_index = 0;
                } else if self.marketplace.catalog_selected_index >= len {
                    self.marketplace.catalog_selected_index = len - 1;
                }
            }
            Some(MarketplaceFlowStep::DetailActions) => {
                let len = self.marketplace_detail_action_items().len();
                if len == 0 {
                    self.marketplace.detail_action_selected_index = 0;
                } else if self.marketplace.detail_action_selected_index >= len {
                    self.marketplace.detail_action_selected_index = len - 1;
                }
            }
            Some(MarketplaceFlowStep::UnverifiedConfirm) => {
                let len = self.marketplace_confirmation_items().len();
                if len == 0 {
                    self.marketplace.confirm_selected_index = 0;
                } else if self.marketplace.confirm_selected_index >= len {
                    self.marketplace.confirm_selected_index = len - 1;
                }
            }
            None => {}
        }
    }

    /// Detail actions: Install when not installed, Update when the registry is newer.
    fn marketplace_detail_action_items(&self) -> Vec<String> {
        let Some(item) = self.marketplace_selected_catalog_item_or_current() else {
            return Vec::new();
        };
        if !item.installed {
            return vec![t!("tui.marketplace.install_action").into_owned()];
        }
        if item.update_available {
            return vec![t!("tui.marketplace.update_action").into_owned()];
        }
        Vec::new()
    }

    fn marketplace_confirmation_items(&self) -> Vec<String> {
        [
            t!("tui.marketplace.confirm_continue").into_owned(),
            t!("tui.marketplace.confirm_cancel").into_owned(),
        ]
        .into_iter()
        .collect()
    }

    fn marketplace_filtered_catalog_indices(&self) -> Vec<usize> {
        let query = self.marketplace.catalog_filter.trim().to_lowercase();
        self.marketplace
            .catalog
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                if query.is_empty() {
                    return Some(index);
                }

                let haystack = format!(
                    "{} {} {} {} {} {}",
                    item.display_name,
                    item.description,
                    item.name,
                    item.id,
                    item.author
                        .as_ref()
                        .map(|author| author.name.as_str())
                        .unwrap_or(""),
                    item.categories.as_deref().unwrap_or(&[]).join(" "),
                );
                haystack.to_lowercase().contains(&query).then_some(index)
            })
            .collect()
    }

    fn marketplace_selected_catalog_item_or_current(&self) -> Option<&CliMarketplaceCatalogEntry> {
        if let Some(current_id) = self.marketplace.current_extension_id.as_deref() {
            if let Some(item) = self
                .marketplace
                .catalog
                .iter()
                .find(|item| item.id == current_id)
            {
                return Some(item);
            }
        }
        self.marketplace_selected_catalog_item()
    }

    fn marketplace_open_selected_detail(&mut self) {
        let Some(extension_id) = self
            .marketplace_selected_catalog_item()
            .map(|item| item.id.clone())
        else {
            return;
        };
        self.marketplace.current_extension_id = Some(extension_id);
        if self.marketplace.step_stack.last().copied() == Some(MarketplaceFlowStep::CatalogPicker) {
            self.marketplace
                .step_stack
                .push(MarketplaceFlowStep::DetailActions);
        }
        self.marketplace.detail_action_selected_index = 0;
        self.marketplace_sync_current_step_selection();
    }

    fn marketplace_run_selected_action(&mut self) {
        let Some(item) = self.marketplace_selected_catalog_item_or_current() else {
            return;
        };
        let action = self
            .marketplace_detail_action_items()
            .get(self.marketplace.detail_action_selected_index)
            .cloned();
        let Some(action) = action else {
            return;
        };

        let install_label = t!("tui.marketplace.install_action").into_owned();
        let update_label = t!("tui.marketplace.update_action").into_owned();
        let (name, source_name, update_id) = if action == install_label {
            (
                Some(item.name.clone()),
                Some(item.source_name.clone()),
                None,
            )
        } else if action == update_label {
            (None, None, Some(item.id.clone()))
        } else {
            return;
        };

        self.marketplace_execute_action(name, source_name, update_id, false);
    }

    /// Install or update through the daemon; the review-required result pushes
    /// the confirmation step instead of failing.
    fn marketplace_execute_action(
        &mut self,
        name: Option<String>,
        source_name: Option<String>,
        update_id: Option<String>,
        review_acknowledged: bool,
    ) {
        let guard_key = name
            .as_deref()
            .map(|value| format!("install:{value}"))
            .or_else(|| update_id.as_deref().map(|value| format!("update:{value}")));
        if let Some(guard_key) = guard_key.as_deref() {
            if self
                .marketplace
                .install_guard
                .as_deref()
                .is_some_and(|current| current == guard_key)
            {
                return;
            }
            self.marketplace.install_guard = Some(guard_key.to_string());
        }

        let result = if let Some(id) = update_id.as_deref() {
            self.runtime.update_extension(id, review_acknowledged)
        } else if let Some(name) = name.as_deref() {
            self.runtime.install_marketplace_extension(
                name,
                source_name.as_deref(),
                review_acknowledged,
            )
        } else {
            return;
        };

        match result {
            Ok(outcome) if outcome.status == "review-required" => {
                if self.marketplace.step_stack.last().copied()
                    != Some(MarketplaceFlowStep::UnverifiedConfirm)
                {
                    self.marketplace
                        .step_stack
                        .push(MarketplaceFlowStep::UnverifiedConfirm);
                }
                self.marketplace.confirm_selected_index = 0;
                self.marketplace.error = None;
                self.marketplace.install_guard = None;
            }
            Ok(outcome) => {
                let installed_name = outcome
                    .extension
                    .as_ref()
                    .map(|extension| extension.display_name.clone());
                if let Err(err) = self.refresh_extensions_from_disk() {
                    self.marketplace.error = Some(err.to_string());
                }
                if let Err(err) = self.refresh_marketplace_catalog() {
                    self.marketplace.error = Some(err.to_string());
                }
                self.marketplace.install_guard = None;
                self.marketplace
                    .step_stack
                    .retain(|step| *step != MarketplaceFlowStep::UnverifiedConfirm);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.marketplace.installed",
                        name = installed_name.unwrap_or_default()
                    )
                    .into_owned(),
                    tool_block: None,
                });
                self.marketplace_sync_current_step_selection();
            }
            Err(err) => {
                self.marketplace.install_guard = None;
                self.marketplace.error = Some(err.to_string());
            }
        }
    }

    fn marketplace_handle_install_confirmation(&mut self) {
        let choice = self
            .marketplace_confirmation_items()
            .get(self.marketplace.confirm_selected_index)
            .cloned();
        let continue_label = t!("tui.marketplace.confirm_continue").into_owned();
        let cancel_label = t!("tui.marketplace.confirm_cancel").into_owned();
        match choice {
            Some(item) if item == continue_label => {
                let Some(entry) = self.marketplace_selected_catalog_item_or_current() else {
                    return;
                };
                let (name, source_name, update_id) = if entry.installed {
                    (None, None, Some(entry.id.clone()))
                } else {
                    (
                        Some(entry.name.clone()),
                        Some(entry.source_name.clone()),
                        None,
                    )
                };
                self.marketplace_execute_action(name, source_name, update_id, true);
            }
            Some(item) if item == cancel_label => self.marketplace_go_back(),
            _ => {}
        }
    }

    pub(super) fn build_marketplace_view_model(&self) -> Option<MarketplaceViewModel> {
        if !self.marketplace.open {
            return None;
        }

        let filtered_indices = self.marketplace_filtered_catalog_indices();
        let catalog_items = filtered_indices
            .iter()
            .filter_map(|index| self.marketplace.catalog.get(*index))
            .map(Self::marketplace_catalog_item_view)
            .collect::<Vec<_>>();

        let selected_item = self
            .marketplace_selected_catalog_item_or_current()
            .map(Self::marketplace_catalog_item_view);

        let detail = self
            .marketplace_selected_catalog_item_or_current()
            .map(Self::marketplace_detail_view);

        let slash = self.build_marketplace_slash_view(&catalog_items, selected_item.is_some());

        Some(MarketplaceViewModel {
            step: self
                .marketplace_current_step()
                .unwrap_or(MarketplaceFlowStep::CatalogPicker),
            query: self.marketplace.catalog_filter.clone(),
            error: self.marketplace.error.clone(),
            sources: self
                .marketplace
                .sources
                .iter()
                .map(|source| MarketplaceSourceTabView {
                    id: source.id.clone(),
                    label: marketplace_source_tab_label(source),
                })
                .collect(),
            active_source_index: self.marketplace.active_source_index,
            catalog_items,
            selected_item,
            detail,
            slash,
        })
    }

    fn marketplace_catalog_item_view(
        item: &CliMarketplaceCatalogEntry,
    ) -> MarketplaceCatalogItemView {
        MarketplaceCatalogItemView {
            id: item.id.clone(),
            name: item.name.clone(),
            display_name: item.display_name.clone(),
            description: item.description.clone(),
            author: item.author.as_ref().map(|author| author.name.clone()),
            review_status: item.review_status.clone(),
            version: item.version.clone(),
            installed: item.installed,
            enabled: item.enabled.unwrap_or(false),
            installed_version: item.installed_version.clone(),
            update_available: item.update_available,
        }
    }

    fn marketplace_detail_view(item: &CliMarketplaceCatalogEntry) -> MarketplaceDetailView {
        let mut contribution_lines = Vec::new();
        if let Some(tools) = item.contributes.as_ref().and_then(|c| c.tools.as_ref()) {
            for tool in tools {
                contribution_lines.push(format!(
                    "{}: {}",
                    t!("tui.marketplace.contribution_tool"),
                    tool.name
                ));
            }
        }
        MarketplaceDetailView {
            id: item.id.clone(),
            name: item.name.clone(),
            display_name: item.display_name.clone(),
            description: item.description.clone(),
            author: item.author.as_ref().map(|author| author.name.clone()),
            review_status: item.review_status.clone(),
            version: item.version.clone(),
            installed: item.installed,
            enabled: item.enabled.unwrap_or(false),
            update_available: item.update_available,
            installed_version: item.installed_version.clone(),
            supported_hosts: item.supported_hosts.clone(),
            requested_capabilities: item.requested_capabilities.clone().unwrap_or_default(),
            contribution_lines,
        }
    }

    fn build_marketplace_slash_view(
        &self,
        catalog_items: &[MarketplaceCatalogItemView],
        has_detail: bool,
    ) -> SlashFlowView {
        match self
            .marketplace_current_step()
            .unwrap_or(MarketplaceFlowStep::CatalogPicker)
        {
            MarketplaceFlowStep::CatalogPicker => SlashFlowView {
                title: t!("tui.marketplace.extensions_title").into_owned(),
                subtitle: None,
                search: Some(crate::view::SlashFlowSearchView {
                    value: self.marketplace.catalog_filter.clone(),
                    placeholder: t!("tui.marketplace.search_placeholder").into_owned(),
                }),
                empty_text: t!("tui.marketplace.no_matching_extensions").into_owned(),
                selected_index: self
                    .marketplace
                    .catalog_selected_index
                    .min(catalog_items.len().saturating_sub(1)),
                items: catalog_items
                    .iter()
                    .map(|item| SlashFlowItemView {
                        label: item.display_name.clone(),
                        summary: item.description.clone(),
                        details: Vec::new(),
                        disabled: false,
                        muted: false,
                    })
                    .collect(),
                compact_items: true,
                footer_hint: t!("tui.marketplace.extensions_footer").into_owned(),
            },
            MarketplaceFlowStep::DetailActions => SlashFlowView {
                title: t!("tui.marketplace.actions_title").into_owned(),
                subtitle: None,
                search: None,
                empty_text: t!("tui.marketplace.no_matching_actions").into_owned(),
                selected_index: self.marketplace.detail_action_selected_index,
                items: self
                    .marketplace_detail_action_items()
                    .into_iter()
                    .map(|item| SlashFlowItemView {
                        label: item,
                        summary: String::new(),
                        details: Vec::new(),
                        disabled: !has_detail,
                        muted: false,
                    })
                    .collect(),
                compact_items: false,
                footer_hint: t!("tui.marketplace.actions_footer").into_owned(),
            },
            MarketplaceFlowStep::UnverifiedConfirm => SlashFlowView {
                title: t!("tui.marketplace.confirm_title").into_owned(),
                subtitle: None,
                search: None,
                empty_text: t!("tui.marketplace.no_matching_options").into_owned(),
                selected_index: self.marketplace.confirm_selected_index.min(
                    self.marketplace_confirmation_items()
                        .len()
                        .saturating_sub(1),
                ),
                items: {
                    let continue_label = t!("tui.marketplace.confirm_continue").into_owned();
                    let cancel_label = t!("tui.marketplace.confirm_cancel").into_owned();
                    self.marketplace_confirmation_items()
                        .into_iter()
                        .map(|item| SlashFlowItemView {
                            summary: if item == continue_label {
                                t!("tui.marketplace.confirm_ack_unverified").into_owned()
                            } else {
                                t!("tui.marketplace.confirm_back_to_detail").into_owned()
                            },
                            muted: item == cancel_label,
                            label: item,
                            details: Vec::new(),
                            disabled: false,
                        })
                        .collect()
                },
                compact_items: false,
                footer_hint: t!("tui.marketplace.confirm_footer").into_owned(),
            },
        }
    }

    pub fn open_marketplace_view(&mut self, query: Option<&str>) {
        self.forms.active = None;
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.tui_picker_active = false;
        self.chat_picker_active = false;
        self.subagent.picker_active = false;
        self.close_subagent_view();
        self.image_picker_active = false;
        self.marketplace.open = true;
        self.marketplace.step_stack = vec![MarketplaceFlowStep::CatalogPicker];
        // Every entry into the marketplace lands on the All pseudo source.
        self.marketplace.active_source_index = 0;
        self.marketplace.catalog_filter = query.unwrap_or("").trim().to_string();
        self.marketplace.catalog_selected_index = 0;
        self.marketplace.detail_action_selected_index = 0;
        self.marketplace.confirm_selected_index = 0;
        self.marketplace.current_extension_id = None;
        self.marketplace.error = None;
        self.marketplace.install_guard = None;

        if let Err(err) = self.refresh_marketplace_catalog() {
            self.marketplace.error = Some(err.to_string());
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.marketplace.read_failed", err = err).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.marketplace_sync_current_step_selection();
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn close_marketplace_view(&mut self) {
        self.marketplace.close();
    }

    pub fn marketplace_step(&self) -> Option<MarketplaceFlowStep> {
        self.marketplace_current_step()
    }
}

/// Tab label: internal sources are localized; user registries show their displayName.
fn marketplace_source_tab_label(source: &CliMarketplaceSource) -> String {
    if source.id == ALL_MARKETPLACE_SOURCE_ID {
        return t!("tui.marketplace.source_all").into_owned();
    }
    if source.id == "built-in" {
        return t!("tui.marketplace.source_built_in").into_owned();
    }
    if source.id == "personal" {
        return t!("tui.marketplace.source_personal").into_owned();
    }
    source.display_name.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(id: &str, internal: bool) -> CliMarketplaceSource {
        CliMarketplaceSource {
            id: id.into(),
            name: id.into(),
            display_name: id.into(),
            kind: "local".into(),
            locator: String::new(),
            git_ref: None,
            added_at_unix_ms: 0,
            internal,
        }
    }

    fn source_ids(sources: &[CliMarketplaceSource]) -> Vec<&str> {
        sources.iter().map(|source| source.id.as_str()).collect()
    }

    #[test]
    fn all_pseudo_source_is_internal_with_the_reserved_id() {
        let source = all_marketplace_source();
        assert_eq!(source.id, ALL_MARKETPLACE_SOURCE_ID);
        assert!(source.internal);
    }

    #[test]
    fn internal_source_tabs_hide_while_their_catalog_is_empty() {
        let visible = visible_marketplace_sources(
            vec![source("built-in", true), source("personal", true)],
            false,
            true,
        );
        assert_eq!(source_ids(&visible), vec!["built-in"]);
    }

    #[test]
    fn user_sources_keep_their_tab_even_when_empty() {
        let visible = visible_marketplace_sources(
            vec![
                source("built-in", true),
                source("personal", true),
                source("abc123", false),
            ],
            true,
            true,
        );
        assert_eq!(source_ids(&visible), vec!["abc123"]);
    }

    #[test]
    fn all_empty_internal_sources_leave_no_visible_tab() {
        let visible = visible_marketplace_sources(
            vec![source("built-in", true), source("personal", true)],
            true,
            true,
        );
        assert!(visible.is_empty());
    }

    #[test]
    fn all_pseudo_source_tab_label_is_localized() {
        assert_eq!(
            marketplace_source_tab_label(&all_marketplace_source()),
            t!("tui.marketplace.source_all").into_owned()
        );
    }

    #[test]
    fn all_pseudo_source_prepends_to_the_source_bar() {
        let mut sources = vec![CliMarketplaceSource {
            id: "built-in".into(),
            name: "built-in".into(),
            display_name: "Built-in".into(),
            kind: "local".into(),
            locator: String::new(),
            git_ref: None,
            added_at_unix_ms: 0,
            internal: true,
        }];
        sources.insert(0, all_marketplace_source());
        assert_eq!(sources[0].id, ALL_MARKETPLACE_SOURCE_ID);
        assert_eq!(sources.len(), 2);
    }
}
